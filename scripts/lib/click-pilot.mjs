// Explicit Linux/local profile, separate from ACE's hosted three-app evaluator.
import {mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {sourceFile,publishable,digest,command} from './ace-project.mjs';
import {nativeHash} from '../../cloud/scripts/native-wire.mjs';

export const upstream='1d038f270701498433cb432f54db89f95f07a845';
const mutable='src/click/types.py',root=resolve(import.meta.dirname,'../..');
const json=value=>JSON.stringify(value,null,2)+'\n';
const dockerArgs=['--host=unix:///var/run/docker.sock'];
const docker=args=>command('docker',[...dockerArgs,...args]);
export function decision(best,candidate){
 if(candidate.build_exit!==0||candidate.compile_exit!==0||candidate.test_exit!==0||candidate.cases.some(c=>c.status==='error'))return{accepted:false,regression:best.cases.some(c=>c.status==='passed'&&!candidate.cases.some(d=>d.id===c.id&&d.status==='passed'))};
 const byId=new Map(candidate.cases.map(c=>[c.id,c.status]));
 if(best.cases.length!==candidate.cases.length||best.cases.some(c=>!byId.has(c.id)))throw Error('Test identities changed');
 const regression=best.cases.some(c=>c.status==='passed'&&byId.get(c.id)!=='passed');
 const unresolved=candidate.cases.some(c=>c.status==='error');
 const preservedSkips=best.cases.filter(c=>['skipped','expected_failure'].includes(c.status)).every(c=>byId.get(c.id)===c.status);
 return{accepted:candidate.build_exit===0&&candidate.compile_exit===0&&candidate.test_exit===0&&!regression&&!unresolved&&preservedSkips&&candidate.cases.filter(c=>c.status==='passed').length>best.cases.filter(c=>c.status==='passed').length,regression};
}
export function proposal(original,value){
 if(!value||Object.keys(value).sort().join(',')!=='files,strategy'||typeof value.strategy!=='string'||!value.strategy.trim()||Buffer.byteLength(value.strategy)>1024||!value.files||Array.isArray(value.files)||Object.keys(value.files).join(',')!==mutable||typeof value.files[mutable]!=='string'||!value.files[mutable].isWellFormed()||Buffer.byteLength(value.files[mutable])>131072)throw Error('Only the bounded Click types.py proposal is allowed');
 return{...original,[mutable]:Buffer.from(value.files[mutable])};
}
export function curated(original){
 const text=original[mutable].toString('utf8');
 const old='incomplete = incomplete.lower()\n            matched = (c for c in str_choices if c.lower().startswith(incomplete))';
 if(text.split(old).length!==2)throw Error('Frozen completion implementation differs');
 return[
  {strategy:'Declared losing proposal: normalize displayed values, which discards original spelling',files:{[mutable]:text.replace(old,'incomplete = incomplete.casefold()\n            matched = (c.casefold() for c in str_choices if c.casefold().startswith(incomplete))')}},
  {strategy:'Use the existing conversion casefold semantics for prefix matching while retaining original display values',files:{[mutable]:text.replace(old,'incomplete = incomplete.casefold()\n            matched = (c for c in str_choices if c.casefold().startswith(incomplete))')}}
 ];
}
async function materialize(directory,files){await mkdir(directory,{mode:0o700});for(const [p,b]of Object.entries(files)){publishable(p);await mkdir(dirname(join(directory,p)),{recursive:true});await writeFile(join(directory,p),b,{flag:'wx',mode:0o600});}}
export async function runPilot({source,output,wheels,binary,image='ace-project-evaluator:local',proposals,example=false,agent='local-developer'}){
 if(process.platform!=='linux')throw Error('The Click evaluator currently requires Linux descriptor-rooted reads and local Docker');
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(agent))throw Error('Use bounded declared provenance');
 if(Boolean(proposals)===Boolean(example))throw Error('Choose either --proposals JSON or --curated-example');
 source=await realpath(resolve(source));wheels=await realpath(resolve(wheels));binary=await realpath(resolve(binary));output=resolve(output);
 const head=command('git',['-C',source,'rev-parse','HEAD']).trim();if(head!==upstream)throw Error('Use the frozen Click 8.3.1 upstream commit');
 const entries=command('git',['-C',source,'ls-tree','-rz','HEAD']).split('\0').filter(Boolean),original={};let bytes=0;
 if(!entries.length||entries.length>4096)throw Error('Source tree exceeds the profile');
 for(const entry of entries){const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);if(!match)throw Error('Only regular upstream source files are allowed');const [,mode,blob,p]=match;publishable(p);const content=await sourceFile(source,p);bytes+=content.length;if(bytes>134217728)throw Error('Source exceeds 128 MiB');const gitHash=createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');if(gitHash!==blob)throw Error('Upstream tracked bytes differ: '+p);original[p]=content;}
 if(new Set(Object.keys(original).map(p=>p.toLowerCase())).size!==entries.length)throw Error('Ambiguous portable source paths');
 const batch=example?curated(original):JSON.parse(await sourceFile(resolve(dirname(proposals)),resolve(proposals).split('/').at(-1),524288));
 if(!Array.isArray(batch)||batch.length<1||batch.length>4)throw Error('Choose 1–4 proposals');batch.forEach(p=>proposal(original,p));
 const dependencies=JSON.parse(await sourceFile(root,'pilots/click/dependencies.json')),fixed={};
 for(const p of ['evaluate.py','test_completion.py','dependencies.json','requirements.lock'])fixed['harness/'+p]=await sourceFile(root,'pilots/click/'+p);
 fixed['harness/driver.mjs']=await sourceFile(root,'scripts/lib/click-pilot.mjs');
 fixed['harness/source-reader.mjs']=await sourceFile(root,'scripts/lib/ace-project.mjs');
 fixed['harness/native-wire.mjs']=await sourceFile(root,'cloud/scripts/native-wire.mjs');
 const wheelBytes={};for(const p of dependencies.packages){const b=await sourceFile(wheels,p.filename);if(digest(b)!==p.sha256)throw Error('Dependency wheel digest differs: '+p.name);wheelBytes[p.filename]=b;}
 const imageId=docker(['image','inspect','--format','{{.Id}}',image]).trim();if(!/^sha256:[0-9a-f]{64}$/.test(imageId))throw Error('Prepare an existing local immutable Python evaluator image');
 const nativeBinary=await sourceFile(dirname(binary),binary.split('/').at(-1),134217728);
 const manifest={schema_version:1,profile:'click-unicode-completion-v1',upstream:{url:'https://github.com/pallets/click',tag:'8.3.1',commit:upstream,license:'BSD-3-Clause'},source_files:Object.fromEntries(Object.entries(original).map(([p,b])=>[p,digest(b)])),harness_files:Object.fromEntries(Object.entries(fixed).map(([p,b])=>[p,digest(b)])),dependencies,image_id:imageId,native_binary_sha256:digest(nativeBinary),node_version:process.version,mutable:[mutable],scope:'Local Linux Python 3.11; real wheel build and fixed public suites. Caller-declared proposals, no hosted qualification or general model benchmark.',paid_cloud_calls:0};
 manifest.context_hash=nativeHash(manifest);
 await mkdir(output,{mode:0o700});const store=join(output,'native');await writeFile(join(output,'manifest.json'),json(manifest),{flag:'wx',mode:0o600});await writeFile(join(output,'proposals.json'),json(batch),{flag:'wx',mode:0o600});
 await materialize(join(output,'harness'),Object.fromEntries(Object.entries(fixed).filter(([p])=>p.startsWith('harness/')).map(([p,b])=>[p.slice(8),b])));await materialize(join(output,'wheels'),wheelBytes);
 const ace=args=>JSON.parse(command(binary,args,{timeout:180000}));
 const commit=async(stage,files,message,parents=[])=>{const list=join(output,'list-'+randomUUID()+'.json');await writeFile(list,json(files),{flag:'wx',mode:0o600});return ace(['store','commit',stage,'--store',store,'--files',list,'--message',message,...parents.flatMap(p=>['--parent',p])]).version;};
 const evaluate=async(files,name,parent)=>{
  const run=join(output,name);await mkdir(run,{mode:0o700});await materialize(join(run,'source'),files);await mkdir(join(run,'results'),{mode:0o700});
  const sourceVersion=await commit(join(run,'source'),Object.keys(files),'Click exact source: '+name,parent?[parent]:[]);
  const container='ace-click-'+randomUUID(),start=Date.now();let result,infra=null;
  const args=[...dockerArgs,'run','--rm','--name',container,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','128','--memory','768m','--memory-swap','768m','--cpus','2','--tmpfs','/work:rw,exec,nosuid,size=256m,uid=1000,gid=1000','--tmpfs','/tmp:rw,noexec,nosuid,size=64m,uid=1000,gid=1000'];
  for(const [src,dst,readonly]of [[join(run,'source'),'/source',true],[join(output,'harness'),'/harness',true],[join(output,'wheels'),'/wheels',true],[join(run,'results'),'/results',false]]){if(src.includes(','))throw Error('Mount paths cannot contain commas');args.push('--mount',`type=bind,src=${src},dst=${dst}${readonly?',readonly':''}`);}
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])args.push('--env',key+'=');
  for(const value of ['HOME=/work','PYTHONDONTWRITEBYTECODE=1','PYTEST_DISABLE_PLUGIN_AUTOLOAD=1','SOURCE_DATE_EPOCH=1764547200','LANG=C.UTF-8'])args.push('--env',value);
  args.push('--entrypoint','python3',imageId,'/harness/evaluate.py');
  try{result=spawnSync('docker',args,{encoding:'utf8',timeout:240000,maxBuffer:4194304});if(result.error||result.signal)infra='timeout_or_output_limit';else if(result.status!==0)infra='evaluator_incomplete';}finally{try{docker(['rm','--force',container]);}catch(error){if(!error.message.includes('No such container'))infra='container_cleanup_failed';}}
  let observation=null;if(!infra){try{observation=JSON.parse(await sourceFile(join(run,'results'),'report.json',1048576));if(!observation.cases?.length&&observation.build_exit===0)infra='no_executed_tests';}catch{infra='missing_evaluator_report';}}
 const report={schema_version:1,profile:manifest.profile,context_hash:manifest.context_hash,source_version:sourceVersion,source_hash:nativeHash(Object.fromEntries(Object.entries(files).map(([p,b])=>[p,digest(b)]))),agent:{name:agent,provenance:example?'declared_curated_proposals':'caller_declared'},status:infra?'infrastructure_failed':observation.build_exit===0&&observation.test_exit===0&&observation.compile_exit===0?'passed':'failed',infrastructure_error:infra,duration_ms:Date.now()-start,observation,scope:manifest.scope};
  const evidence={'report.json':Buffer.from(json(report)),'stdout.log':Buffer.from(result?.stdout??''),'stderr.log':Buffer.from(result?.stderr??''),'manifest.json':Buffer.from(json(manifest)),...fixed};
  if(!infra&&observation.build_exit===0)evidence['tests.xml']=await sourceFile(join(run,'results'),'tests.xml',4194304);
  evidence['learning.json']=Buffer.from(json({schema_version:1,source_version:sourceVersion,context_hash:manifest.context_hash,status:report.status,failed_cases:observation?.cases.filter(c=>['failed','error'].includes(c.status)).map(c=>c.id)??[],correctness_inferred:!infra,claims:infra?['Incomplete infrastructure is not an incorrect-code result.']:['Only the recorded fixed public cases establish this outcome.'],promotion:'requires_independent_review'}));
  await materialize(join(run,'evidence'),evidence);const resultVersion=await commit(join(run,'evidence'),Object.keys(evidence),'Click result: '+name+' '+report.status,[sourceVersion]);
  console.log(json({attempt:name,status:report.status,cases:observation?Object.fromEntries(['passed','failed','error','skipped','expected_failure'].map(s=>[s,observation.cases.filter(c=>c.status===s).length])):null}).trim());return{source_version:sourceVersion,result_version:resultVersion,report,files};
 };
 let best=await evaluate(original,'baseline',null);const baseline=best,rounds=[];
 if(best.report.status==='infrastructure_failed')throw Error('Baseline infrastructure failed; retained evidence at '+output);
 const branch='click-unicode-completion';ace(['store','branch',store,branch,best.source_version]);
 for(const [i,p]of batch.entries()){
  const candidate=await evaluate(proposal(best.files,p),'round-'+(i+1),best.source_version);
  const selection=candidate.report.status==='infrastructure_failed'?{accepted:false,regression:null}:decision(best.report.observation,candidate.report.observation);
  rounds.push({source_version:candidate.source_version,result_version:candidate.result_version,report:candidate.report,strategy:p.strategy,...selection});
  if(selection.accepted){ace(['store','branch',store,branch,candidate.source_version,'--expect',best.source_version]);best=candidate;}
 }
 const summary={schema_version:1,profile:manifest.profile,context_hash:manifest.context_hash,baseline:{source_version:baseline.source_version,result_version:baseline.result_version,report:baseline.report},best:{source_version:best.source_version,result_version:best.result_version,report:best.report},rounds,branch,scope:manifest.scope,paid_cloud_calls:0};
 await writeFile(join(output,'summary.json'),json(summary),{flag:'wx',mode:0o600});
 const summaryVersion=await commit(output,['summary.json','manifest.json','proposals.json'],'Click pilot: exact source and positive/negative learning',[best.result_version,...rounds.filter(r=>r.result_version!==best.result_version).slice(-1).map(r=>r.result_version)]);
 const validation=ace(['store','log',store]);await writeFile(join(output,'native-validation.json'),json(validation),{flag:'wx',mode:0o600});
 await rm(join(output,'wheels'),{recursive:true});return{output,summary_version:summaryVersion,best_source:best.source_version,baseline_status:baseline.report.status,best_status:best.report.status,scope:manifest.scope,paid_cloud_calls:0};
}
