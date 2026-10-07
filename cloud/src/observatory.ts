// Bounded manual proposals use trusted assembly, existing distributed evaluation,
// and native retention. Neither browser measurements nor verdicts are accepted.
import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from 'cloudflare:workers';
import {z} from 'zod';
import {type Env,type ExperimentState,HttpError,json,sha256,strictJson,immutablePut,coordinate,planSchema} from './contracts';
import {type Identity} from './accounts';
import * as projects from './projects';
import {storeName,nativeHash,putObject,putVersion,appendEntry,versionSchema,type NativeEntry} from './native-store';
import {submit} from './submission';
const encoder=new TextEncoder(),encode=(v:unknown)=>encoder.encode(JSON.stringify(v));
const requestSchema=z.strictObject({cell:z.enum(['Gcd','MaxU32','MinU32']).default('Gcd'),request_id:z.uuid(),wat:z.string().min(1).max(32768).refine(s=>encoder.encode(s).length<=32768&&s.trim().length>0),strategy:z.string().min(1).max(1024).refine(s=>encoder.encode(s).length<=1024&&s.trim().length>0)});
export type TrialJob={id:string;project:string;experiment:string;actor:string;requestHash:string;requestKey:string};
type Row={id:string;project:string;actor:string;request_hash:string;request_key:string;experiment:string;status:string;plan_hash:string|null;native_version:string|null;error:string|null;created_at:number;updated_at:number};
const day=()=>new Date().toISOString().slice(0,10);
export async function containerBudget(env:Env){const result=await coordinate(env,'OBSERVATORY-BUDGET-'+day(),'observatory-container-budget') as {allowed:boolean};if(!result.allowed)throw new Error('daily Observatory assembly/archive container budget exhausted');}
async function row(env:Env,id:string){const result=await env.DB.prepare('SELECT * FROM observatory_trials WHERE id = ?').bind(id).first<Row>();if(!result)throw new HttpError(404,'trial not found');return result;}
export async function listTrials(env:Env,actor:Identity,project:string){await projects.access(env,actor,project);const result=await env.DB.prepare('SELECT id,experiment,status,created_at,updated_at,native_version,error FROM observatory_trials WHERE project = ? ORDER BY created_at DESC LIMIT 100').bind(project).all();return json({trials:result.results,limits:{trials_per_day:8,assembly_archive_containers_per_day:16,candidates_per_trial:1,baseline_evaluations:1},cells:['Gcd','MaxU32','MinU32']});}
export async function readTrial(env:Env,actor:Identity,project:string,id:string){await projects.access(env,actor,project);const trial=await row(env,id);if(trial.project!==project)throw new HttpError(404,'trial not found');let evaluation=null;if(trial.plan_hash){const state=await coordinate(env,trial.experiment,'status') as ExperimentState;evaluation={status:state.status,completed:state.completed,total:state.count};}return json({id:trial.id,experiment:trial.experiment,status:trial.status,created_at:trial.created_at,native_version:trial.native_version,error:trial.error,evaluation});}
export async function readProposal(env:Env,actor:Identity,project:string,id:string){await projects.access(env,actor,project);const trial=await row(env,id);if(trial.project!==project)throw new HttpError(404,'trial not found');const object=await env.ARTIFACTS.get(trial.request_key);if(!object||object.size>65536)throw new HttpError(503,'original proposal missing');const bytes=await object.arrayBuffer();if(await sha256(bytes)!==trial.request_hash)throw new HttpError(503,'original proposal corrupted');const request=strictJson(new TextDecoder().decode(bytes));return json(request);}
export async function retryTrial(env:Env,actor:Identity,project:string,id:string){
 await projects.access(env,actor,project,'write');if(!env.OBSERVATORY_TRIALS)throw new HttpError(503,'Observatory workflow unavailable');const trial=await row(env,id);if(trial.project!==project)throw new HttpError(404,'trial not found');if(trial.status!=='failed')return json({id,status:trial.status});
 const instance=await env.OBSERVATORY_TRIALS.get(id),state=await instance.status();if(!['errored','terminated'].includes(state.status))throw new HttpError(409,'previous attempt is still ending');
 const now=Date.now(),updated=await env.DB.prepare("UPDATE observatory_trials SET status = 'requested',error = NULL,updated_at = ? WHERE id = ? AND status = 'failed'").bind(now,id).run();
 if(updated.meta.changes){try{await instance.restart();}catch(error){await env.DB.prepare("UPDATE observatory_trials SET status = 'failed',error = 'Retry could not start; original proposal retained.' WHERE id = ? AND status = 'requested' AND updated_at = ?").bind(id,now).run();throw error;}await projects.audit(env,actor,project,'trial.retry',id);}
 return json({id,status:'requested'},202);
}
export async function requestTrial(env:Env,actor:Identity,project:string,input:Uint8Array){
 storeName.parse(project);await projects.access(env,actor,project,'write');if(!env.OBSERVATORY_TRIALS)throw new HttpError(503,'Observatory workflow is not configured');
 const request=requestSchema.parse(strictJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(input)));
 const author=actor.kind+':'+actor.username,digest=await sha256(encode([project,author,request.request_id])),id='trial-'+digest,experiment='EXP-OBS-'+digest;
 const body=encode({project,experiment,wat:request.wat,strategy:request.strategy,...(request.cell==='Gcd'?{}:{cell:request.cell})}),requestHash=await sha256(body),requestKey=`observatory/${id}/request.json`;
 const previous=await env.DB.prepare('SELECT request_hash FROM observatory_trials WHERE id = ?').bind(id).first<{request_hash:string}>();if(previous&&previous.request_hash!==requestHash)throw new HttpError(409,'trial request identity already contains different source');
 if(!previous){const budget=await coordinate(env,'OBSERVATORY-BUDGET-'+day(),'observatory-register',{id}) as {allowed:boolean};if(!budget.allowed)throw new HttpError(429,'daily limit of eight Observatory trials reached');}
 await immutablePut(env.ARTIFACTS,requestKey,body);const now=Date.now();
 await env.DB.prepare("INSERT INTO observatory_trials (id,project,actor,request_hash,request_key,experiment,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'requested',?,?) ON CONFLICT(id) DO NOTHING").bind(id,project,author,requestHash,requestKey,experiment,now,now).run();
 await env.DB.prepare("INSERT INTO project_resource_owners (kind,id,project) VALUES ('experiment',?,?) ON CONFLICT(kind,id) DO NOTHING").bind(experiment,project).run();
 const job:TrialJob={id,project,experiment,actor:author,requestHash,requestKey};
 try{await env.OBSERVATORY_TRIALS.create({id,params:job});}catch(error){const instance=await env.OBSERVATORY_TRIALS.get(id);const state=await instance.status();if(!state.status||state.status==='unknown')throw error;}
 await projects.audit(env,actor,project,'trial.request',id,id);return json({id,experiment,status:(await row(env,id)).status},202);
}
export type NativeBundle={sealed:z.infer<typeof versionSchema>;objects:{hash:string;base64:string}[]};
export async function publishTrial(env:Env,job:TrialJob,bundle:NativeBundle){
 const trial=await row(env,job.id);if(trial.request_hash!==job.requestHash||trial.project!==job.project)throw new Error('trusted trial identity differs');
 const sealed=versionSchema.parse(bundle.sealed);if(sealed.version.kind.kind!=='evaluation'||sealed.version.parents.length||bundle.objects.length>128)throw new Error('expected a bounded trusted evaluation snapshot');
 const id=sealed.content_hash;if(await nativeHash(sealed.version)!==id)throw new Error('trusted snapshot hash differs');
 const objects=new Map<string,Uint8Array>();let total=0;for(const item of bundle.objects){if(objects.has(item.hash))throw new Error('duplicate snapshot object');const bytes=Uint8Array.from(atob(item.base64),c=>c.charCodeAt(0));total+=bytes.length;if(total>16777216||await sha256(bytes)!==item.hash)throw new Error('trusted snapshot export corrupted');objects.set(item.hash,bytes);}
 for(const hash of new Set(Object.values(sealed.version.files)))if(!objects.has(hash))throw new Error('trusted snapshot export incomplete');
 const runHash=sealed.version.files['run/run.json'];if(!runHash)throw new Error('trusted report missing');const run=strictJson(new TextDecoder().decode(objects.get(runHash)!)) as {content_hash:string;report:{experiment:{id:string};config:{project:string}}};
 if(run.content_hash!==sealed.version.kind.report_hash||run.report.experiment.id!==job.experiment||run.report.config.project!==job.project)throw new Error('trusted report belongs to another experiment');
 for(const [hash,bytes]of objects)await putObject(env,job.project,hash,bytes);await putVersion(env,job.project,id,encode(sealed));
 let published=false;for(let attempt=0;attempt<6;attempt++){const log=await coordinate(env,'NATIVE-STORE-'+job.project,'native-log') as {entries:NativeEntry[];tip:string|null};const old=log.entries.find(e=>e.version===id);const entry=old??{schema_version:1,sequence:log.entries.length+1,previous:log.tip,version:id,content_hash:await nativeHash([1,log.entries.length+1,log.tip,id])};try{await appendEntry(env,job.project,encode(entry),job.actor);published=true;break;}catch(error){if(!(error instanceof HttpError)||error.status!==409)throw error;}}
 if(!published)throw new Error('native journal busy; retry trusted publication');
 await env.DB.prepare("UPDATE observatory_trials SET status = 'completed',native_version = ?,error = NULL,updated_at = ? WHERE id = ?").bind(id,Date.now(),job.id).run();
 await projects.audit(env,{kind:'operator',username:'observatory',role:'admin'},job.project,'trial.complete',id,job.id+'-completed');return{id:job.id,version:id};
}
export class ObservatoryWorkflow extends WorkflowEntrypoint<Env,TrialJob>{
 async run(event:WorkflowEvent<TrialJob>,step:WorkflowStep){const job=event.payload;
  try{
   const prepared=await step.do('assemble bounded proposal',{retries:{limit:1,delay:'5 seconds',backoff:'constant'},timeout:'15 minutes'},async()=>{
    await containerBudget(this.env);await this.env.DB.prepare("UPDATE observatory_trials SET status = 'assembling',updated_at = ? WHERE id = ?").bind(Date.now(),job.id).run();
    const result=await this.env.SANDBOXES.getByName(job.id+'-compile-'+crypto.randomUUID()).prepareTrial(job);return{planHash:result.planHash};
   });
   await step.do('register trusted evaluation',async()=>{
    const object=await this.env.ARTIFACTS.get(`observatory/${job.id}/prepared/plan.json`);if(!object)throw new Error('trusted plan missing');const bytes=new Uint8Array(await object.arrayBuffer());if(await sha256(bytes)!==prepared.planHash)throw new Error('trusted plan changed');const plan=planSchema.parse(strictJson(new TextDecoder().decode(bytes)));if(plan.config.project!==job.project||plan.config.experiment!==job.experiment)throw new Error('trusted plan scope differs');
    await submit(this.env,bytes);await this.env.DB.prepare("UPDATE observatory_trials SET status = 'evaluating',plan_hash = ?,updated_at = ? WHERE id = ?").bind(prepared.planHash,Date.now(),job.id).run();
   });
   let done=false;for(let attempt=0;attempt<240;attempt++){
    const state=await step.do('inspect evaluation '+attempt,async()=>{const state=await coordinate(this.env,job.experiment,'status') as ExperimentState;return{status:state.status};});
    if(state.status==='failed')throw new Error('distributed evaluation infrastructure failed');if(state.status==='completed'){done=true;break;}await step.sleep('evaluation pause '+attempt,'15 seconds');
   }if(!done)throw new Error('Observatory evaluation deadline exceeded');
   await step.do('retain native source and learning',{retries:{limit:1,delay:'5 seconds',backoff:'constant'},timeout:'15 minutes'},async()=>{
    const trial=await row(this.env,job.id);if(trial.status==='completed')return{version:trial.native_version};
    await containerBudget(this.env);await this.env.DB.prepare("UPDATE observatory_trials SET status = 'archiving',updated_at = ? WHERE id = ?").bind(Date.now(),job.id).run();
    const bundle=await this.env.SANDBOXES.getByName(job.id+'-archive-'+crypto.randomUUID()).archiveTrial(job);return publishTrial(this.env,job,bundle);
   });return{trial:job.id,status:'completed'};
  }catch(error){await step.do('retain infrastructure or assembly failure',async()=>{await this.env.DB.prepare("UPDATE observatory_trials SET status = 'failed',error = 'Assembly, evaluation or retention could not finish. Original proposal retained; no new qualification.',updated_at = ? WHERE id = ? AND status != 'completed'").bind(Date.now(),job.id).run();await projects.audit(this.env,{kind:'operator',username:'observatory',role:'admin'},job.project,'trial.failed',job.id,job.id+'-failed');});throw error;}
 }
}
