// Verification receipts can only originate from the configured trusted evaluator.
import { z } from 'zod';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {type Env,HttpError,hash,identifier,json,strictJson,sha256,immutablePut,coordinate} from './contracts';
import {storeName,loadVersion,nativeHash} from './native-store';
import type {RunFile} from './sandbox';

const decision=z.discriminatedUnion('action',[z.strictObject({action:z.literal('elite')}),z.strictObject({action:z.literal('kill'),reason:z.enum(['hard_check_failed','hard_constraint_failed','oracle_failed','evaluation_failed'])}),z.strictObject({action:z.literal('hold'),reason:z.enum(['context_mismatch','incomplete_evidence','evaluation_error','oracle_error','future_evidence'])})]);
const outcomes=z.enum(['qualified','failed_correctness','failed_contract','failed_resource_limit','invalid_module','budget_exhausted','evaluator_error']);
export const receiptSchema=z.strictObject({schema_version:z.literal(1),status:z.enum(['reproduced','mismatch','inconclusive']),
  original_report_hash:hash,snapshot_report_hash:hash,original_environment_hash:hash,verified_report_hash:hash,verified_environment_hash:hash,
  same_environment:z.boolean(),harness_hash:hash,champion:identifier.nullable(),champion_matches:z.boolean(),
  source_count:z.number().int().min(0).max(101),evaluator_binary_hash:hash,runtime:z.string().min(1).max(256),scope:z.string().min(1).max(2048),
  candidates:z.array(z.strictObject({candidate:identifier,artifact_hash:hash,claimed_outcome:outcomes,observed_outcome:outcomes,matched:z.boolean(),
    evidence_hash:hash,decision})).min(2).max(101)
}).superRefine((r,ctx)=>{
  const rows=r.candidates,ids=new Set(rows.map(c=>c.candidate));
  if(rows.some(c=>c.matched&&c.claimed_outcome!==c.observed_outcome)||ids.size!==rows.length||r.champion!==null&&!rows.some(c=>c.candidate===r.champion&&c.observed_outcome==='qualified'&&c.decision.action==='elite')
    ||r.status==='reproduced'&&(!r.champion_matches||rows.some(c=>!c.matched||['budget_exhausted','evaluator_error'].includes(c.observed_outcome))))ctx.addIssue({code:'custom',message:'inconsistent verification receipt'});
});
export type VerificationJob={store:string;version:string;verifier:string;workflow:string};
type State={workflow:string;status:'requested'|'running'|'completed'|'failed';requested_at:number;completed_at:number|null;receipt_key:string|null;receipt_hash:string|null;error:string|null};
const encoder=new TextEncoder();
function verifier(env:Env){if(!env.NATIVE_VERIFIER_BINARY_HASH)throw new HttpError(503,'native server verification is not configured');return hash.parse(env.NATIVE_VERIFIER_BINARY_HASH);}
async function state(env:Env,job:Pick<VerificationJob,'store'|'version'|'verifier'>){return await env.DB.prepare('SELECT workflow, status, requested_at, completed_at, receipt_key, receipt_hash, error FROM native_verifications WHERE store = ? AND version = ? AND verifier = ?').bind(job.store,job.version,job.verifier).first<State>();}
export async function readVerification(env:Env,store:string,version:string){
  const job={store:storeName.parse(store),version:hash.parse(version),verifier:verifier(env)};
  const configured=job.verifier;let value=await state(env,job);
  if(!value){const previous=await env.DB.prepare("SELECT verifier FROM native_verifications WHERE store = ? AND version = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1").bind(job.store,job.version).first<{verifier:string}>();if(previous){job.verifier=previous.verifier;value=await state(env,job);}}
  if(!value)return json({status:'not_requested',verifier:job.verifier});
  const metadata={status:value.status,verifier:job.verifier,current_evaluator:job.verifier===configured,requested_at:value.requested_at,completed_at:value.completed_at,error:value.error};
  if(value.status!=='completed')return json(metadata);
  if(!value.receipt_key||!value.receipt_hash)throw new HttpError(503,'verification receipt missing');
  const object=await env.ARTIFACTS.get(value.receipt_key);if(!object)throw new HttpError(503,'verification receipt missing');
  const bytes=await object.arrayBuffer();if(await sha256(bytes)!==value.receipt_hash)throw new HttpError(503,'verification receipt corrupted');
  const envelope=z.strictObject({receipt:receiptSchema,store:storeName,version:hash,verifier:hash,files:z.record(z.string(),hash)}).parse(strictJson(new TextDecoder().decode(bytes)));
  const receipt=envelope.receipt,sealed=await loadVersion(env,job.store,job.version);
  if(envelope.store!==job.store||envelope.version!==job.version||envelope.verifier!==job.verifier||sealed.version.kind.kind!=='evaluation'||sealed.version.kind.report_hash!==receipt.original_report_hash||receipt.evaluator_binary_hash!==job.verifier)throw new HttpError(503,'verification evaluator identity differs');
  return json({...metadata,receipt,receipt_hash:value.receipt_hash,version:job.version,store:job.store,files:envelope.files});
}
export async function requestVerification(env:Env,store:string,version:string){
  const job={store:storeName.parse(store),version:hash.parse(version),verifier:verifier(env),workflow:''};
  const sealed=await loadVersion(env,store,version);if(sealed.version.kind.kind!=='evaluation')throw new HttpError(409,'only evaluated native versions can be verified');
  const log=await coordinate(env,`NATIVE-STORE-${store}`,'native-log') as {entries:{version:string}[]};
  if(!log.entries.some(e=>e.version===version))throw new HttpError(409,'publish the native journal before requesting verification');
  job.workflow='nv-'+(await nativeHash([store,version,job.verifier])).slice(0,60);
  const inserted=await env.DB.prepare("INSERT INTO native_verifications (store,version,verifier,workflow,status,requested_at) VALUES (?,?,?,?,'requested',?) ON CONFLICT(store,version,verifier) DO NOTHING")
    .bind(store,version,job.verifier,job.workflow,Date.now()).run();
  let previous=await state(env,job);if(previous?.status==='completed')return await readVerification(env,store,version);
  if(previous?.status==='failed'){
    const next='nv-'+(await nativeHash([store,version,job.verifier,crypto.randomUUID()])).slice(0,60);
    await env.DB.prepare("UPDATE native_verifications SET workflow = ?, status = 'requested', requested_at = ?, completed_at = NULL, error = NULL WHERE store = ? AND version = ? AND verifier = ? AND status = 'failed'").bind(next,Date.now(),store,version,job.verifier).run();
    previous=await state(env,job);
  }
  if(previous)job.workflow=previous.workflow;
  try{await env.NATIVE_VERIFICATIONS.create({id:job.workflow,params:job});}
  catch(error){const existing=await env.NATIVE_VERIFICATIONS.get(job.workflow);const observed=await existing.status();if(!observed.status||observed.status==='unknown')throw error;}
  return json({status:previous?.status??'requested',workflow:job.workflow,verifier:job.verifier,created:inserted.meta.changes===1},202);
}
export async function completeVerification(env:Env,job:VerificationJob,raw:string,files:RunFile[]){
  const current=await state(env,job);if(!current||current.workflow!==job.workflow)throw new Error('verification attempt was superseded');
  const receipt=receiptSchema.parse(strictJson(raw)),sealed=await loadVersion(env,job.store,job.version);
  if(sealed.version.kind.kind!=='evaluation'||receipt.original_report_hash!==sealed.version.kind.report_hash
    ||receipt.snapshot_report_hash!==receipt.original_report_hash||receipt.evaluator_binary_hash!==job.verifier)throw new Error('trusted receipt does not bind the registered native version and evaluator');
  const prefix=`native-verifications/${job.store}/${job.version}/${job.verifier}/${receipt.verified_report_hash}/`;
  // The completed server run retains all evidence and policy JSON, not only a badge.
  const seen=new Set<string>(),fileHashes:Record<string,string>={};let size=0;
  for(const file of files){
    if(!/^(?:run|environment|intent|experiment|knowledge|champion|baseline-champion)\.json$|^candidates\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/(?:candidate|evaluation|evidence|decision)\.json$/.test(file.path)||seen.has(file.path))throw new Error('unexpected verified run file');
    seen.add(file.path);const bytes=encoder.encode(file.content);fileHashes[file.path]=await sha256(bytes);size+=bytes.length;if(size>8388608)throw new Error('verified run exceeds export limit');
  }
  const required=['run.json','environment.json','intent.json','experiment.json','knowledge.json',...(receipt.champion?['champion.json']:[]),...receipt.candidates.flatMap(c=>['candidate','evaluation','evidence','decision'].map(kind=>`candidates/${c.candidate}/${kind}.json`))];
  if(required.some(path=>!seen.has(path)))throw new Error('verified run is incomplete');
  const run=files.find(f=>f.path==='run.json');if(!run||(strictJson(run.content) as {content_hash:string}).content_hash!==receipt.verified_report_hash)throw new Error('verified run differs from receipt');
  for(const file of files)await immutablePut(env.ARTIFACTS,prefix+'run/'+file.path,encoder.encode(file.content));
  const key=prefix+'receipt.json',bytes=encoder.encode(JSON.stringify({receipt,store:job.store,version:job.version,verifier:job.verifier,files:fileHashes})),digest=await sha256(bytes);await immutablePut(env.ARTIFACTS,key,bytes);
  await env.DB.prepare("UPDATE native_verifications SET status = 'completed', completed_at = ?, receipt_key = ?, receipt_hash = ?, error = NULL WHERE store = ? AND version = ? AND verifier = ? AND status != 'completed' AND workflow = ?")
    .bind(Date.now(),key,digest,job.store,job.version,job.verifier,job.workflow).run();
}
export async function readVerifiedRun(env:Env,store:string,version:string){
  const response=await readVerification(env,store,version),value=await response.json() as {status:string;verifier:string;receipt?:z.infer<typeof receiptSchema>;files?:Record<string,string>};
  if(value.status!=='completed'||!value.receipt||!value.files?.['run.json'])throw new HttpError(409,'no completed server verification');
  const job={store,version,verifier:value.verifier},current=await state(env,job);
  const key=current!.receipt_key!.slice(0,-'receipt.json'.length)+'run/run.json';
  const file=await env.ARTIFACTS.get(key);if(!file)throw new HttpError(503,'verified run missing');
  const bytes=await file.arrayBuffer();if(await sha256(bytes)!==value.files['run.json'])throw new HttpError(503,'verified run corrupted');
  return new Response(bytes,{headers:{'content-type':'application/json'}});
}
export class NativeVerificationWorkflow extends WorkflowEntrypoint<Env,VerificationJob>{
  async run(event:WorkflowEvent<VerificationJob>,step:WorkflowStep){const job=event.payload;
    try{
      const result=await step.do('independent native evaluation',{retries:{limit:1,delay:'30 seconds',backoff:'constant'},timeout:'15 minutes'},async()=>{
        const current=await state(this.env,job);if(current?.status==='completed'||current?.workflow!==job.workflow)return {done:true as const};
        const day=new Date().toISOString().slice(0,10);
        const budget=await coordinate(this.env,'NATIVE-VERIFY-BUDGET-'+day,'native-verify-budget') as {allowed:boolean};
        if(!budget.allowed)throw new Error('native verification daily budget exhausted');
        await this.env.DB.prepare("UPDATE native_verifications SET status = 'running' WHERE store = ? AND version = ? AND verifier = ? AND status != 'completed' AND workflow = ?").bind(job.store,job.version,job.verifier,job.workflow).run();
        const sandbox=this.env.SANDBOXES.get(this.env.SANDBOXES.idFromName(job.workflow+'-'+crypto.randomUUID()));
        const bundle=await sandbox.verifyNative(job.store,job.version);
        await completeVerification(this.env,job,bundle.receipt,bundle.files);
        return {done:true as const};
      });return result;
    }catch(error){await step.do('record verification failure',async()=>{
      await this.env.DB.prepare("UPDATE native_verifications SET status = 'failed', completed_at = ?, error = ? WHERE store = ? AND version = ? AND verifier = ? AND status != 'completed' AND workflow = ?")
        .bind(Date.now(),'Server verification could not finish; no qualification or code-failure conclusion.',job.store,job.version,job.verifier,job.workflow).run();
    });throw error;}
  }
}
