import {beforeEach,it,expect,vi} from 'vitest';
import {env,runInDurableObject} from 'cloudflare:test';
import worker from '../src/worker';
import {type Env,coordinate,sha256} from '../src/contracts';
import {spendingStatus,reservePaidStart,updateSpending,readSpending,SNAPSHOT_MAX_AGE_MS} from '../src/spending-control';
import {EvaluationSandbox} from '../src/sandbox';
import {generate} from '../src/generator';
import {consumeEvaluation} from '../src/pipeline';
const protectedEnv:Env={...env,SPENDING_CONTROL_MODE:'enforce'};
const operator={kind:'operator',username:'operator',role:'admin'} as const;
const encode=(x:unknown)=>new TextEncoder().encode(JSON.stringify(x));
const stub=()=>env.COORDINATORS.get(env.COORDINATORS.idFromName('ACE-ACCOUNT-SPENDING'));
beforeEach(async()=>{await runInDurableObject(stub(),async(_,ctx)=>ctx.storage.deleteAll());const day=new Date().toISOString().slice(0,10);await runInDurableObject(env.COORDINATORS.get(env.COORDINATORS.idFromName('GENERATOR-BUDGET-'+day)),async(_,ctx)=>ctx.storage.deleteAll());});
const input=(total_cents=500,revision=0)=>({revision,period_start:Date.now()-3600000,period_end:Date.now()+86400000,observed_at:Date.now(),total_cents});
async function seed(total=500){await updateSpending(protectedEnv,operator,encode(input(total)));}
async function changeStored(change:Record<string,unknown>){await runInDurableObject(stub(),async(_,ctx)=>{const state=await ctx.storage.get<Record<string,unknown>>('spending-control');await ctx.storage.put('spending-control',{...state,...change});});}
it('fails closed without account dollars and does not treat unknown billing as zero',async()=>{
 expect(await spendingStatus(protectedEnv)).toMatchObject({enforced:true,paused:true,reason:'billing_snapshot_missing',snapshot:null,reserved_cents:0});
 await expect(reservePaidStart(protectedEnv,'container')).rejects.toThrow('billing_snapshot_missing');
 expect((await spendingStatus(protectedEnv)).revision).toBe(0);
 // Default behavior is also enforced when a production config omits the flag.
 expect((await spendingStatus({...protectedEnv,SPENDING_CONTROL_MODE:undefined})).paused).toBe(true);
});
it('serializes concurrent starts across projects and leaves the 25 dollar margin',async()=>{
 await seed(16000);
 const results=await Promise.allSettled(Array.from({length:30},()=>reservePaidStart(protectedEnv,'container')));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
 expect(await spendingStatus(protectedEnv)).toMatchObject({reserved_cents:1000,snapshot:{total_cents:16000}});
 // Separate attempts are separate possible charges; there is no replay refund.
 await reservePaidStart(protectedEnv,'ai');await reservePaidStart(protectedEnv,'ai');await reservePaidStart(protectedEnv,'ai');await reservePaidStart(protectedEnv,'ai');
 expect((await spendingStatus(protectedEnv)).paused).toBe(true);
 await expect(reservePaidStart(protectedEnv,'ai')).rejects.toThrow('budget_margin');
});
it('expires observations and billing periods without automatically resetting spending',async()=>{
 await seed();const state=await spendingStatus(protectedEnv),snapshot=state.snapshot!;
 await changeStored({snapshot:{...snapshot,period_start:Date.now()-2*SNAPSHOT_MAX_AGE_MS,observed_at:Date.now()-SNAPSHOT_MAX_AGE_MS}});
 await expect(reservePaidStart(protectedEnv,'ai')).rejects.toThrow('billing_snapshot_stale');
 await changeStored({snapshot:{...snapshot,period_end:Date.now()-1}});
 await expect(reservePaidStart(protectedEnv,'container')).rejects.toThrow('billing_period_expired');
});
it('requires operator authority and revision agreement, preserving reservations on newer observations',async()=>{
 await expect(updateSpending(protectedEnv,{kind:'account',username:'admin',role:'admin'},encode(input()))).rejects.toThrow('infrastructure operator');
 await seed();await reservePaidStart(protectedEnv,'container');const state=await spendingStatus(protectedEnv),s=state.snapshot!;
 await expect(updateSpending(protectedEnv,operator,encode({...s,revision:0}))).rejects.toThrow('revision changed');
 await expect(updateSpending(protectedEnv,operator,encode({...s,revision:state.revision,total_cents:s.total_cents-1}))).rejects.toThrow('cannot decrease');
 await expect(updateSpending(protectedEnv,operator,encode({...s,revision:state.revision,period_start:s.period_start+1}))).rejects.toThrow('cannot reset');
 await updateSpending(protectedEnv,operator,encode({...s,revision:state.revision,total_cents:700,observed_at:Date.now()}));
 expect(await spendingStatus(protectedEnv)).toMatchObject({reserved_cents:500,snapshot:{total_cents:700}});
});
it('keeps a manual pause latched until an operator supplies a recent observation and explicitly resumes',async()=>{
 await seed();await updateSpending(protectedEnv,operator,encode({revision:1}),true);
 const state=await spendingStatus(protectedEnv);
 await updateSpending(protectedEnv,operator,encode({...state.snapshot,revision:state.revision,observed_at:Date.now()}));
 expect((await spendingStatus(protectedEnv)).reason).toBe('operator_paused');
 const latest=await spendingStatus(protectedEnv);await updateSpending(protectedEnv,operator,encode({...latest.snapshot,revision:latest.revision,observed_at:Date.now(),resume:true}));
 expect((await spendingStatus(protectedEnv)).paused).toBe(false);
});
it('rejects forged future or fractional dollar observations and does not overwrite authority',async()=>{
 for(const bad of [{...input(),observed_at:Date.now()+10000},{...input(),total_cents:0.5},{...input(),cutoff_cents:200000},{...input(),period_start:Date.now()+10000}])await expect(updateSpending(protectedEnv,operator,encode(bad))).rejects.toThrow();
 expect((await spendingStatus(protectedEnv)).revision).toBe(0);
});
it('resets only for a nonoverlapping new billing period after the previous period has ended',async()=>{
 await seed();await reservePaidStart(protectedEnv,'container');const state=await spendingStatus(protectedEnv);
 await changeStored({snapshot:{...state.snapshot,period_start:Date.now()-31*86400000,period_end:Date.now()-3600000}});
 await updateSpending(protectedEnv,operator,encode({...input(),revision:state.revision}));
 expect((await spendingStatus(protectedEnv)).reserved_cents).toBe(0);
});
it('stops new paid API requests before dispatch while keeping authentication and native browsing available',async()=>{
 const request=(path:string,method='GET')=>new Request('https://ace'+path,{method,headers:{authorization:'Bearer '+env.API_TOKEN}});
 expect((await worker.fetch(new Request('https://ace/v1/spending-control'),protectedEnv)).status).toBe(401);
 for(const path of ['/v1/experiments','/v1/generate/qwen','/v1/judge/flash','/v1/projects/fixture/applications','/v1/projects/fixture/application-campaigns','/v1/projects/fixture/trials','/v1/stores/fixture/versions/'+'a'.repeat(64)+'/verify'])expect((await worker.fetch(request(path,'POST'),protectedEnv)).status).toBe(429);
 expect((await worker.fetch(request('/v1/stores'),protectedEnv)).status).toBe(200);
 expect((await worker.fetch(request('/v1/auth/me'),protectedEnv)).status).toBe(200);
 expect((await worker.fetch(request('/'),protectedEnv)).status).toBe(200);
});
it('never calls a model while paused and keeps failed-call allowances and retained results',async()=>{
 const wat='(module)',zero='0'.repeat(64),run=vi.fn(async()=>{throw Error('provider unavailable');});
 const task={context_hash:zero,context:{schema_version:1,campaign:'guard-'+crypto.randomUUID(),round:1,attempt:1,max_candidates:1,previous_fault:null,contract:{cell:'Gcd',abi:'gcd(i32,i32)->i32',semantics:'gcd(0,0)=0',objective:'reduce fuel',public_cases:[[0,0]],fuel_per_call:50000,memory_pages:16,min_relative_improvement:0.01},memory:{schema_version:1,project:'PRJ-test',cell:'Gcd',intent:'INT-test',environment_hash:zero,evalspec_hash:zero,compatible_runs:1,excluded_runs:0,truncated:false,seen_artifacts:[zero],observations:[],winner:{experiment:'EXP-fixture',candidate:'C-fixture',report_hash:zero,artifact_hash:zero,source_hash:await sha256(new TextEncoder().encode(wat)),wat,mean_fuel:'100',strategy:'fixture',evidence:'EV-fixture',evidence_hash:zero,commit:'0'.repeat(40)}}}};
 const bindings={...protectedEnv,AI:{run}},bytes=encode(task);
 await expect(generate(bindings,bytes,'qwen')).rejects.toThrow('billing_snapshot_missing');expect(run).not.toHaveBeenCalled();
 await seed();expect(await(await generate(bindings,bytes,'qwen')).json()).toMatchObject({fault:'unavailable'});
 expect((await spendingStatus(protectedEnv)).reserved_cents).toBe(100);
 await coordinate(env,'ACE-ACCOUNT-SPENDING','spending-pause',{revision:2});
 await generate(bindings,bytes,'qwen');expect(run).toHaveBeenCalledTimes(1);expect((await spendingStatus(protectedEnv)).reserved_cents).toBe(100);
});
it('guards the real container start primitive and preserves reservations after process failure',async()=>{
 const start=vi.fn(),destroy=vi.fn(async()=>{}),container={images:{ace:'fixture'},start,destroy};
 await runInDurableObject(env.COORDINATORS.get(env.COORDINATORS.idFromName('container-guard-fixture')),async(_,ctx)=>{
 Object.defineProperty(ctx,'container',{value:container,configurable:true});
 const sandbox=new EvaluationSandbox(ctx,protectedEnv) as unknown as {withContainer(action:()=>Promise<unknown>):Promise<unknown>};
 const process=vi.fn(async()=>{throw Error('process failed');});
 await expect(sandbox.withContainer(process)).rejects.toThrow('billing_snapshot_missing');
 expect(start).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled();
 await seed();await expect(sandbox.withContainer(process)).rejects.toThrow('process failed');
 expect(start).toHaveBeenCalledTimes(1);expect(destroy).toHaveBeenCalledTimes(1);expect((await spendingStatus(protectedEnv)).reserved_cents).toBe(500);
 // A failed process can have incurred charges; a second execution reserves again.
 await expect(sandbox.withContainer(process)).rejects.toThrow('process failed');expect((await spendingStatus(protectedEnv)).reserved_cents).toBe(1000);
 delete (ctx as unknown as {container?:unknown}).container;
 });
});
it('shows only availability to project members, without account spending amounts',async()=>{
 await seed(12345);
 const result=await(await readSpending(protectedEnv,{kind:'account',username:'reader',role:'reader'})).json();
 expect(result).toEqual({schema_version:1,enforced:true,paused:false,reason:null,ai_allowed:true,containers_allowed:true});
});
it('acknowledges paused queued work without starting a sandbox, retry storms or false correctness claims',async()=>{
 const job={experiment:'EXP-spend-'+crypto.randomUUID(),planHash:'0'.repeat(64),index:0};
 await coordinate(env,job.experiment,'init',{...job,project:'PRJ-budget',count:2});
 await env.DB.prepare('INSERT INTO experiments(id,project,plan_hash,status,created_at) VALUES(?,?,?,?,?)').bind(job.experiment,'PRJ-budget',job.planHash,'registered',Date.now()).run();
 const retained='experiments/'+job.experiment+'/original-source';await env.ARTIFACTS.put(retained,'original source');
 const evaluate=vi.fn(),bindings={...protectedEnv,SANDBOXES:{getByName:()=>({evaluate})},EXPERIMENTS:{get:async()=>({sendEvent:async()=>{}})}} as unknown as Env;
 expect(await consumeEvaluation(bindings,job)).toBe('ack');expect(await consumeEvaluation(bindings,job)).toBe('ack');
 expect(evaluate).not.toHaveBeenCalled();expect(await coordinate(env,job.experiment,'status')).toMatchObject({status:'failed',completed:0,error:'Paid execution paused by account spending control; no correctness conclusion.'});
 expect(await(await env.ARTIFACTS.get(retained))!.text()).toBe('original source');
});
