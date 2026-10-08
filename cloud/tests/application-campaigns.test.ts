import {it,expect,beforeEach} from 'vitest';
import {env,SELF,runInDurableObject} from 'cloudflare:test';
import type {WorkflowStep} from 'cloudflare:workers';
import {type Env,sha256,coordinate} from '../src/contracts';
import {ensure} from '../src/projects';
import {templates,nodeTemplates,cases,checkCase,type AppReport} from '../src/application-profiles';
import {requestApp,publishSource,finishApp,loadAppSource,type AppJob} from '../src/applications';
import {nativeHash,loadVersion,readRefs} from '../src/native-store';
import {checkedRun,requestCampaign,readCampaign,cancelCampaign,runCampaign,generateApplication,improves,type CampaignJob,type CampaignState} from '../src/application-campaigns';
const actor={kind:'operator',username:'operator',role:'admin'} as const;
// Isolate daily counters between independent scenarios, without changing policy.
beforeEach(async()=>{const day=new Date().toISOString().slice(0,10);for(const prefix of ['OBSERVATORY-BUDGET-','GENERATOR-BUDGET-'])await runInDurableObject(env.COORDINATORS.get(env.COORDINATORS.idFromName(prefix+day)),async(_instance,state)=>{await state.storage.deleteAll();});});
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const step={do:async(_name:string,options:unknown,callback?:()=>Promise<unknown>)=>typeof options==='function'?options():callback!()} as unknown as WorkflowStep;
async function report(files:Record<string,string>,pass=0):Promise<AppReport>{
 const observations=cases.calculator.map((test,i)=>checkCase(test,{exit_code:0,timed_out:false,stdout:JSON.stringify(i<pass?test.expected:{wrong:true}),stderr:''}));
 return{schema_version:1,profile:'calculator',runtime:'3.11.2',compiled:true,compile_errors:[],status:pass===cases.calculator.length?'passed':'failed',cases:observations,passed:pass,total:cases.calculator.length,source_hash:await nativeHash(files),suite_hash:await nativeHash(cases.calculator),image_hash:null,scope:'fixed independent public suite'};
}
async function fixture(pass=0,node=false){
 const project='campaign-'+crypto.randomUUID();await ensure(env,actor,project);
 const files=node?{...nodeTemplates.calculator,'src/core.js':"module.exports={handle:()=>({wrong:true})};\n"}:{...templates.calculator,'core.py':'def handle(request):\n return {"wrong": True}\n'},source={request_id:crypto.randomUUID(),profile:'calculator',files,parent:null,branch:null};
 const registered=await(await requestApp(env,actor,project,encode(source),false)).json() as {id:string},stored=await env.DB.prepare('SELECT request_hash,request_key FROM application_runs WHERE id=?').bind(registered.id).first<{request_hash:string;request_key:string}>();
 const job:AppJob={id:registered.id,project,actor:'operator:operator',requestHash:stored!.request_hash,requestKey:stored!.request_key};
 const original=await publishSource(env,job,files,[],'recorded baseline');await env.DB.prepare('UPDATE application_runs SET source_version=? WHERE id=?').bind(original,job.id).run();await finishApp(env,job,source as Parameters<typeof finishApp>[2],await report(files,pass));
 const args={request_id:crypto.randomUUID(),baseline_run:job.id,model:'qwen' as const,rounds:2,patience:2,branch:'agent-result'};
 const configured={...env,APPLICATION_CAMPAIGNS:{create:async()=>({})}} as unknown as Env;
 const accepted=await(await requestCampaign(configured,actor,project,encode(args))).json() as {id:string},row=await env.DB.prepare('SELECT request_hash,request_key,state_json FROM application_campaigns WHERE id=?').bind(accepted.id).first<{request_hash:string;request_key:string;state_json:string}>();
 const campaign:CampaignJob={id:accepted.id,project,actor,requestHash:row!.request_hash,requestKey:row!.request_key};
 return{project,args,job:campaign,state:JSON.parse(row!.state_json) as CampaignState,baseline:await checkedRun(env,actor,project,registered.id),config:configured};
}
it('accepts only a strict correctness gain without regressing previously passing cases',async()=>{
 const files=templates.calculator,best=await report(files,2),gain=await report(files,4);expect(improves(best,gain)).toBe(true);expect(improves(best,best)).toBe(false);
 const regressed={...gain,cases:gain.cases.map((c,i)=>i===0?{...c,passed:false}:c),passed:3};expect(improves(best,regressed)).toBe(false);
});
it('retains raw generations, avoids repeated provider calls and forbids manifest/dependency or forged-verdict output',async()=>{
 const f=await fixture();let calls=0;
 const configured={...f.config,AI:{run:async()=>{calls++;return{response:JSON.stringify({strategy:'Fake approved result',files:{'dependencies.lock.json':'unlocked'},passed:true})};}}} as Env;
 const first=await generateApplication(configured,f.job,f.args,f.baseline,f.state,1),retry=await generateApplication(configured,f.job,f.args,f.baseline,f.state,1);expect(retry).toEqual(first);expect(calls).toBe(1);expect(first.fault).toBe('invalid_proposal');expect(first.files).toBeNull();
 const retained=await loadVersion(env,f.project,first.version);expect(retained.version.kind.kind).toBe('generator_fault');expect(retained.version.files).toHaveProperty('campaign/generation/response.json');
});
it('runs a bounded campaign, remembers losing evidence and retains improved source and learning in native history',async()=>{
 const f=await fixture();let calls=0,executions=0;const contexts:Record<string,unknown>[]=[];
 const configured={...f.config,AI:{run:async(_model:string,input:Record<string,unknown>)=>{calls++;contexts.push(JSON.parse((input.messages as {content:string}[])[1]!.content));return{response:{strategy:calls===1?'First attempt':'Correct failing behavior',files:{'core.py':calls===1?'def handle(request):\n return {"wrong": 2}\n':templates.calculator['core.py']}}};}},
  SANDBOXES:{getByName:()=>({testApplication:async(job:AppJob)=>{executions++;const source=await loadAppSource(env,job);return report(source.files,executions===1?0:29);}})}} as unknown as Env;
 const result=await runCampaign(configured,f.job,step) as CampaignState;expect(result.stop_reason).toBe('suite_complete');expect(result.best_passed).toBe(29);expect(result.rounds.map(r=>r.accepted)).toEqual([false,true]);expect(result.branch_updated).toBe(true);expect(calls).toBe(2);expect(executions).toBe(2);
 expect(contexts[1]).toMatchObject({learning:{observations:[{passed:0,accepted:false,run:expect.any(String)}]}});
 const retained=await loadVersion(env,f.project,result.summary_version!);expect(retained.version.files).toHaveProperty('campaign/learning.json');expect(retained.version.files['core.py']).toBe(await sha256(new TextEncoder().encode(templates.calculator['core.py'])));expect((await(await readRefs(env,f.project)).json() as {heads:Record<string,string>}).heads['agent-result']).toBe(result.summary_version);
 expect((await(await readCampaign(env,actor,f.project,f.job.id)).json() as {status:string}).status).toBe('completed');
});
it('a fully passing baseline stops without inference or containers and cancellation prevents further work',async()=>{
 const f=await fixture(29);let calls=0;const configured={...f.config,AI:{run:async()=>{calls++;throw new Error('must not execute');}}} as Env;
 const result=await runCampaign(configured,f.job,step) as CampaignState;expect(result.rounds).toHaveLength(0);expect(result.stop_reason).toBe('suite_complete');expect(calls).toBe(0);
 const cancelled=await fixture();await cancelCampaign(env,actor,cancelled.project,cancelled.job.id);expect(await runCampaign(configured,cancelled.job,step)).toEqual({status:'cancelled'});
});
it('rejects stale evaluator evidence, protects project privacy and preserves retry identity',async()=>{
 const f=await fixture();expect((await(await requestCampaign(f.config,actor,f.project,encode(f.args))).json() as {id:string}).id).toBe(f.job.id);
 await expect(requestCampaign(f.config,actor,f.project,encode({...f.args,rounds:4}))).rejects.toThrow('identity');
 await expect(checkedRun({...env,APPLICATION_IMAGE_HASH:'sha256:'+'a'.repeat(64)},actor,f.project,f.args.baseline_run)).rejects.toThrow('test again');
 await expect(readCampaign(env,{kind:'account',username:'outsider',role:'admin'},f.project,f.job.id)).rejects.toThrow('project not found');expect((await SELF.fetch(`https://ace/v1/projects/${f.project}/application-campaigns`)).status).toBe(401);
});
it('duplicate proposals stop at the patience bound without testing the same source again',async()=>{
 const f=await fixture();const configured={...f.config,AI:{run:async()=>({response:{strategy:'Repeat',files:{'core.py':f.baseline.files['core.py']}}})}} as Env;
 const result=await runCampaign(configured,f.job,step) as CampaignState;expect(result.stop_reason).toBe('stagnation');expect(result.rounds).toHaveLength(2);expect(result.rounds.every(r=>r.fault==='duplicate_proposal'&&r.run===null)).toBe(true);
 const log=await coordinate(env,'NATIVE-STORE-'+f.project,'native-log') as {entries:{version:string}[]};expect(log.entries.length).toBe(5);
});

it('application agents select JavaScript source and cannot insert files from a different runtime',async()=>{const f=await fixture(0,true);let prompt='';const configured={...f.config,AI:{run:async(_model:string,input:Record<string,unknown>)=>{prompt=(input.messages as {content:string}[])[0]!.content;return{response:{strategy:'Repair decimal arithmetic',files:{'src/core.js':nodeTemplates.calculator['src/core.js']}}};}}} as Env;const proposed=await generateApplication(configured,f.job,f.args,f.baseline,f.state,1);expect(proposed.fault).toBeNull();expect(proposed.files?.['src/core.js']).toBe(nodeTemplates.calculator['src/core.js']);expect(proposed.files?.['package-lock.json']).toBe(f.baseline.files['package-lock.json']);expect(prompt).toContain('JavaScript (Node)');const bad={...configured,AI:{run:async()=>({response:{strategy:'Wrong runtime',files:{'core.py':'unrelated'}}})}} as Env;expect((await generateApplication(bad,f.job,f.args,f.baseline,f.state,2)).fault).toBe('invalid_proposal');});
