import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceFile} from './ace-project.mjs';
import {nativeHash} from '../../cloud/scripts/native-wire.mjs';
import cases from '../../applications/cases.json' with {type:'json'};
import templates from '../../applications/templates.json' with {type:'json'};
const boolean=value=>typeof value==='boolean'||Array.isArray(value)&&value.some(boolean)||value&&typeof value==='object'&&Object.values(value).some(boolean);

// Evidence proposes a repair; it never grants qualification or moves a branch.
export async function strictTypeLearning({store,failure,success,image,binary='target/debug/ace'}){
 const root=await mkdtemp(join(tmpdir(),'ace-task-memory-'));binary=resolve(binary);
 const read=async(version,name)=>{
  if(!/^[a-f0-9]{64}$/.test(version??''))throw Error('Invalid evidence version');
  const directory=join(root,name);execFileSync(binary,['store','checkout',version,'--store',resolve(store),'--output',directory],{timeout:120000,maxBuffer:4194304});
  const record=JSON.parse((await sourceFile(directory,'task/evaluation.json',1048576)).toString('utf8')),suite=cases[record.profile],files={};
  if(!suite||record.image_hash!==image||record.suite_hash!==nativeHash(suite)||record.report.source_hash!==record.source_hash||record.report.image_hash!==image||record.report.suite_hash!==record.suite_hash||record.report.cases.length!==suite.length)throw Error('Stale or incompatible application learning');
  for(const p of Object.keys(templates[record.profile]))files[p]=(await sourceFile(directory,p,32768)).toString('utf8');
  if(nativeHash(files)!==record.source_hash||record.report.cases.some((c,i)=>c.id!==suite[i].id||nativeHash(c.expected)!==nativeHash(suite[i].expected)))throw Error('Learning source or independent suite differs');
  return{version,record};
 };
 try{
  const a=await read(failure,'failure'),b=await read(success,'success');
  if(a.record.profile!==b.record.profile||a.record.suite_hash!==b.record.suite_hash||!a.record.report.compiled||b.record.report.status!=='passed'||b.record.report.passed!==b.record.report.total)throw Error('Resolved evidence is incomplete');
  const suite=cases[a.record.profile],index=suite.findIndex((c,i)=>boolean(c.input)&&c.expected.error==='invalid_request'&&a.record.report.cases[i].passed===false&&a.record.report.cases[i].error===null&&nativeHash(a.record.report.cases[i].actual)!==nativeHash(c.expected)&&b.record.report.cases[i].passed===true&&nativeHash(b.record.report.cases[i].actual)===nativeHash(c.expected));
  if(index<0)throw Error('No resolved boolean type-validation evidence');
  return{schema_version:1,rule:'strict-boolean-input-validation',failure:{version:failure,source_hash:a.record.source_hash,report_hash:nativeHash(a.record.report)},success:{version:success,source_hash:b.record.source_hash,report_hash:nativeHash(b.record.report)},image_hash:image,suite_hash:a.record.suite_hash,case:suite[index].id,scope:'Locally retained caller-declared evidence. Use only when the fresh target contract declares boolean input invalid; every proposal requires fresh independent evaluation.'};
 }finally{await rm(root,{recursive:true,force:true});}
}
export function chooseWithLearning(memory,profile,pool){
 if(memory?.rule!=='strict-boolean-input-validation'||!cases[profile]?.some(c=>boolean(c.input)&&c.expected.error==='invalid_request'))throw Error('Learning does not apply to the target contract');
 const selected=pool.find(p=>p.recipe===memory.rule);if(!selected)throw Error('No compatible declared repair proposal');
 return{strategy:selected.strategy,files:selected.files};
}
