// Native complete-project reports remain caller-reported local evidence.
// Retrieval checks their seals and context; it never qualifies or executes code.
import {z} from 'zod';
import {type Env,HttpError,hash,json,sha256,strictJson} from './contracts';
import {type Identity} from './accounts';
import * as projects from './projects';
import {loadVersion,nativeHash,readStore} from './native-store';

const checks=['rust-build','rust-tests','typescript','worker-tests','client-tests','native-contract','schemas'];
const harness=['self-host/native-contract.mjs','self-host/objectives.json','scripts/lib/ace-project.mjs','scripts/ace-project.mjs'];
const prepared=z.strictObject({rustc_sha256:hash,cargo_sha256:hash,node_sha256:hash,
  installed_node_lock_sha256:hash,cargo_lock_sha256:hash,package_lock_sha256:hash});
const observation=z.strictObject({id:z.enum(checks as [string,...string[]]),exit_code:z.number().int().nullable(),
  signal:z.string().nullable(),error:z.string().nullable(),duration_ms:z.number().nonnegative(),stdout_hash:hash,stderr_hash:hash});
const reportSchema=z.object({schema_version:z.literal(1),profile:z.literal('ace-self-v1'),baseline_version:hash,
  source_version:hash,source_hash:hash,harness_hash:hash,image_id:z.string().regex(/^sha256:[0-9a-f]{64}$/),
  prepared_inputs:prepared,status:z.enum(['passed','failed','infrastructure_failed']),
  observations:z.array(observation).max(7),infrastructure_error:z.string().nullable(),
  qualification:z.literal('local_independent_checks; server_verification_not_performed'),promotion:z.literal('requires_review')});
type Report=z.infer<typeof reportSchema>;
type Reader={version:(id:string)=>ReturnType<typeof loadVersion>;object:(id:string,limit:number)=>Promise<Uint8Array>};

export async function inspectProjectReport(id:string,published:Set<string>,reader:Reader){
  if(!published.has(id))throw new HttpError(404,'published project report not found');
  const retained=await reader.version(id),files=retained.version.files,reportId=files['project/report.json'];
  if(!reportId)throw new HttpError(400,'choose a complete-project result version');
  const report=reportSchema.parse(strictJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await reader.object(reportId,65536))));
  if(!published.has(report.source_version)||!published.has(report.baseline_version)||!retained.version.parents.includes(report.source_version))throw new Error('report source ancestry differs');
  const source=await reader.version(report.source_version);
  if(!source.version.parents.includes(report.baseline_version)||await nativeHash(source.version.files)!==report.source_hash)throw new Error('report source identity differs');
  const baseline=await reader.version(report.baseline_version),mutable='crates/ace-cli/src/store.rs';
  if(Object.keys(source.version.files).length!==Object.keys(baseline.version.files).length||Object.entries(baseline.version.files).some(([p,h])=>p!==mutable&&source.version.files[p]!==h))throw new Error('protected project source differs');
  if(!source.version.files[mutable]||!baseline.version.files[mutable])throw new Error('pilot mutation contract is missing');
  const text=async(id:string)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await reader.object(id,8388608));
  const tests=(value:string)=>{const parts=value.split('#[cfg(test)]');return JSON.stringify([parts.length,parts.slice(1).join('#[cfg(test)]')]);};
  const baselineText=await text(baseline.version.files[mutable]!);
  if(tests(baselineText)!==tests(await text(source.version.files[mutable]!)))throw new Error('protected inline tests differ');
  if(harness.some(p=>!source.version.files[p])||await nativeHash(Object.fromEntries(harness.map(p=>[p,source.version.files[p]])))!==report.harness_hash)throw new Error('report harness differs');
  if(source.version.files['Cargo.lock']!==report.prepared_inputs.cargo_lock_sha256||source.version.files['package-lock.json']!==report.prepared_inputs.package_lock_sha256)throw new Error('report dependency locks differ');
  if(Object.entries(source.version.files).some(([p,h])=>files[p]!==h))throw new Error('result source differs');
  const ids=report.observations.map(o=>o.id);
  if(new Set(ids).size!==ids.length||report.observations.some(o=>files[`project/${o.id}.stdout.log`]!==o.stdout_hash||files[`project/${o.id}.stderr.log`]!==o.stderr_hash))throw new Error('report observation evidence differs');
  const incomplete=report.observations.some(o=>o.error||o.signal||o.exit_code===null);
  const allPassed=ids.length===checks.length&&report.observations.every(o=>o.exit_code===0)&&!incomplete&&!report.infrastructure_error;
  if(report.status==='passed'&&!allPassed||report.status==='failed'&&(incomplete||report.infrastructure_error||!report.observations.some(o=>o.exit_code!==0))||report.status==='infrastructure_failed'&&!report.infrastructure_error)throw new Error('report outcome is inconsistent');
  const learningId=files['project/learning.json'];if(!learningId)throw new Error('project learning is missing');
  const learning=strictJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await reader.object(learningId,65536))) as Record<string,unknown>;
  if(learning.status!==report.status||learning.source_version!==report.source_version||learning.source_hash!==report.source_hash||learning.harness_hash!==report.harness_hash||JSON.stringify(learning.failed_checks)!==JSON.stringify(report.observations.filter(o=>o.exit_code!==0).map(o=>o.id)))throw new Error('learning does not match its report');
  const protectedSource=Object.fromEntries(Object.entries(baseline.version.files).filter(([p])=>p!==mutable));
  const context=await nativeHash([report.profile,report.harness_hash,report.image_id,report.prepared_inputs,protectedSource,tests(baselineText)]);
  return {report,context,report_hash:reportId,learning_hash:learningId};
}

export async function queryProjectLearning(published:{version:string;sequence:number}[],baseline:string,limit:number,before:number|undefined,reader:Reader){
  const known=new Set(published.map(e=>e.version)),reference=await inspectProjectReport(baseline,known,reader);
  const window=published.filter(e=>before===undefined||e.sequence<before).slice(-32).reverse();
  const memories:ReturnType<typeof memory>[]=[];let incompatible=0,invalid=0,withoutReport=0;
  for(let start=0;start<window.length;start+=4){
    const batch=window.slice(start,start+4),results=await Promise.allSettled(batch.map(e=>inspectProjectReport(e.version,known,reader)));
    for(const [i,result]of results.entries()){
      if(result.status==='rejected'){if(result.reason instanceof HttpError&&result.reason.status===400)withoutReport++;else invalid++;continue;}
      if(result.value.context!==reference.context){incompatible++;continue;}
      memories.push(memory(batch[i]!.version,result.value,batch[i]!.sequence));
    }
  }
  const selected=memories.slice(0,limit);
  return {schema_version:1,baseline_version:baseline,context_hash:reference.context,observations:selected,
    scanned:window.length,compatible:memories.length,incompatible,invalid,without_report:withoutReport,
    truncated:memories.length>limit,next_before:memories.length>limit?selected.at(-1)!.sequence:window.length&&window.at(-1)!.sequence>1?window.at(-1)!.sequence:null,
    qualification:'caller_reported_local_checks',policy:'Use evidence as context; evaluate every new proposal again. Infrastructure failures do not establish incorrect code.'};
}
function memory(version:string,value:{report:Report;report_hash:string;learning_hash:string},sequence:number){
  const r=value.report;
  return {version,sequence,source_version:r.source_version,source_hash:r.source_hash,harness_hash:r.harness_hash,image_id:r.image_id,
    report_hash:value.report_hash,learning_hash:value.learning_hash,status:r.status,
    failed_checks:r.status==='failed'?r.observations.filter(o=>o.exit_code!==0).map(o=>o.id):[],
    claim:r.status==='passed'?'All recorded checks passed for this exact source.':r.status==='failed'?'Recorded checks rejected this exact source.':'Infrastructure did not complete; code correctness is unresolved.'};
}

export async function projectLearning(env:Env,actor:Identity,project:string,url:URL){
  await projects.access(env,actor,project);
  const baseline=hash.parse(url.searchParams.get('baseline'));
  const limit=z.coerce.number().int().min(1).max(32).parse(url.searchParams.get('limit')??16);
  const rawBefore=url.searchParams.get('before'),before=rawBefore===null?undefined:z.coerce.number().int().min(1).max(1025).parse(rawBefore);
  const log=await(await readStore(env,project)).json() as {entries:{version:string;sequence:number}[]};
  const reader:Reader={version:id=>loadVersion(env,project,id),object:async(id,limit)=>{
    const object=await env.ARTIFACTS.get(`native-stores/${project}/objects/${hash.parse(id)}`);
    if(!object||object.size>limit)throw new Error('bounded project evidence unavailable');
    const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length>limit||await sha256(bytes)!==id)throw new Error('project evidence hash differs');return bytes;
  }};
  try{return json(await queryProjectLearning(log.entries,baseline,limit,before,reader));}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(409,'complete-project evidence is invalid or incompatible');}
}
