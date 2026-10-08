// Local complete-project campaigns. The CLI owns the fixed suite and sandbox;
// supplied proposals cannot change dependencies, tests or evaluation labels.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceFile} from './ace-project.mjs';
import {nativeHash} from '../../cloud/scripts/native-wire.mjs';
import templates from '../../applications/templates.json' with {type:'json'};

export function improves(best,candidate){
 const passing=new Set(best.cases.filter(c=>c.passed).map(c=>c.id));
 return candidate.compiled&&candidate.passed>best.passed&&candidate.cases.filter(c=>c.passed&&passing.has(c.id)).length===passing.size;
}
export function proposalFiles(base,proposal){
 if(!proposal||Object.keys(proposal).sort().join(',')!=='files,strategy'||typeof proposal.strategy!=='string'||!proposal.strategy.trim()||Buffer.byteLength(proposal.strategy)>1024||!proposal.files||Array.isArray(proposal.files))throw Error('invalid_proposal');
 const edits=Object.entries(proposal.files);
 if(!edits.length||edits.some(([p,b])=>!['main.py','core.py'].includes(p)||typeof b!=='string'||!b.isWellFormed()||Buffer.byteLength(b)>32768))throw Error('invalid_proposal');
 return {...base,...proposal.files};
}
export async function runTask({profile,baseline,proposals,output,binary='target/debug/ace',image='ace-applications:local',agent='external-agent',store}){
 if(!Object.hasOwn(templates,profile)||!Array.isArray(proposals)||proposals.length<1||proposals.length>4||!/^[A-Za-z0-9_-]{1,64}$/.test(agent))throw Error('Choose a supported profile, 1–4 proposals and bounded declared agent name');
 output=resolve(output);binary=resolve(binary);store=resolve(store??join(output,'native'));await mkdir(output,{mode:0o700});
 const proposalBytes=JSON.stringify(proposals);if(Buffer.byteLength(proposalBytes)>262144)throw Error('Proposal batch exceeds 256 KiB');
 await writeFile(join(output,'proposals.json'),proposalBytes+'\n',{mode:0o600,flag:'wx'});
 const ace=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',timeout:180000,maxBuffer:4194304}));
 const names=Object.keys(templates[profile]),base={};
 for(const p of names){base[p]=(await sourceFile(resolve(baseline),p,32768)).toString('utf8');if(!['core.py','main.py'].includes(p)&&base[p]!==templates[profile][p])throw Error('Protected manifest, dependency or project contract changed');}
 const evaluate=async(files,name,parent,proposal)=>{
  const source=join(output,name);await mkdir(source,{mode:0o700});
  for(const [p,b]of Object.entries(files))await writeFile(join(source,p),b,{mode:0o600,flag:'wx'});
  const start=Date.now(),result=ace(['app','test',source,'--output',join(output,name+'-result'),'--image',image]);
  if(result.report.source_hash!==nativeHash(files))throw Error('Independent evaluator source differs');
  const report=result.report,record={schema_version:1,profile,agent:{name:agent,provenance:'caller_declared'},source_hash:report.source_hash,suite_hash:report.suite_hash,image_hash:report.image_hash,duration_ms:Date.now()-start,report,proposal};
  await mkdir(join(source,'task'));await writeFile(join(source,'task/evaluation.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600});
  await writeFile(join(source,'task/learning.json'),JSON.stringify({schema_version:1,source_hash:report.source_hash,suite_hash:report.suite_hash,image_hash:report.image_hash,status:report.status,failed_cases:report.cases.filter(c=>!c.passed),scope:report.scope},null,2)+'\n',{mode:0o600});
  const list=join(output,name+'-files.json');await writeFile(list,JSON.stringify([...names,'task/evaluation.json','task/learning.json']),{mode:0o600});
  const version=ace(['store','commit',source,'--store',store,'--files',list,'--message',`Complete application ${profile}: ${name} ${report.status}`,...(parent?['--parent',parent]:[])]).version;
  return{version,files,...record};
 };
 let best=await evaluate(base,'baseline',null,null);const first=best,rounds=[];
 if(best.report.status==='passed')throw Error('Use a reproducibly failing baseline; no proposals evaluated');
 const branch='task-'+profile+'-'+nativeHash(output).slice(0,12);ace(['store','branch',store,branch,best.version]);
 for(const [i,proposal]of proposals.entries()){
  if(best.report.status==='passed')break;
  let files;try{files=proposalFiles(best.files,proposal);}catch{rounds.push({round:i+1,status:'generator_fault',fault:'invalid_proposal',proposal_hash:nativeHash(proposal),correctness_inferred:false});continue;}
  const candidate=await evaluate(files,'round-'+(i+1),best.version,proposal),accepted=improves(best.report,candidate.report);
  if(candidate.suite_hash!==best.suite_hash||candidate.image_hash!==best.image_hash)throw Error('Evaluator changed during campaign');
  rounds.push({round:i+1,status:candidate.report.status,version:candidate.version,source_hash:candidate.source_hash,passed:candidate.report.passed,total:candidate.report.total,duration_ms:candidate.duration_ms,accepted});
  if(accepted){ace(['store','branch',store,branch,candidate.version,'--expect',best.version]);best=candidate;}
 }
 const summary={schema_version:1,profile,agent:{name:agent,provenance:'caller_declared'},baseline:{version:first.version,passed:first.report.passed,total:first.report.total,source_hash:first.source_hash},best:{version:best.version,passed:best.report.passed,total:best.report.total,source_hash:best.source_hash},rounds,suite_hash:best.suite_hash,image_hash:best.image_hash,branch,scope:'Local Linux complete Python applications; independent fixed public suites, offline containers, declared proposals. No hosted qualification, provider authenticity or performance claim.',paid_cloud_calls:0};
 await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
 const list=join(output,'summary-files.json');await writeFile(list,JSON.stringify(['summary.json','proposals.json']),{mode:0o600});
 const parents=[...new Set([best.version,...rounds.filter(r=>r.version).slice(-1).map(r=>r.version)])];
 const summary_version=ace(['store','commit',output,'--store',store,'--files',list,'--message','Complete task campaign: source, results and declared agent provenance',...parents.flatMap(p=>['--parent',p])]).version;
 ace(['store','log',store]);return{summary:{...summary,summary_version},baseline:first,best};
}
