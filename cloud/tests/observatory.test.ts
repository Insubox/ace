import {it,expect} from 'vitest';
import {env,SELF} from 'cloudflare:test';
import {type Env,coordinate,sha256} from '../src/contracts';
import {ensure,grant} from '../src/projects';
import {requestTrial,retryTrial,listTrials,readTrial,readProposal,publishTrial,type TrialJob} from '../src/observatory';
import {nativeHash} from '../src/native-store';
const operator={username:'operator',kind:'operator',role:'admin'} as const;
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const proposal=()=>({request_id:crypto.randomUUID(),wat:'(module)',strategy:'manual bounded proposal'});
async function fixture(){const project='observatory-'+crypto.randomUUID();await ensure(env,operator,project);let calls=0;const configured={...env,OBSERVATORY_TRIALS:{create:async()=>{calls++;return{};},get:async()=>({status:async()=>({status:'running'})})}} as unknown as Env;
 const source=proposal(),response=await requestTrial(configured,operator,project,encode(source)),accepted=await response.json() as {id:string;experiment:string};const stored=await env.DB.prepare('SELECT * FROM observatory_trials WHERE id = ?').bind(accepted.id).first<{request_hash:string;request_key:string}>();
 const job:TrialJob={...accepted,project,actor:'operator:operator',requestHash:stored!.request_hash,requestKey:stored!.request_key};return{project,configured,source,job,calls:()=>calls};}
it('requires authentication and rejects caller-provided measurements and extra fields',async()=>{
 expect((await SELF.fetch('https://ace/v1/projects/private/trials',{method:'POST',body:JSON.stringify(proposal())})).status).toBe(401);
 const f=await fixture();await expect(requestTrial(f.configured,operator,f.project,encode({...proposal(),verdict:'qualified'}))).rejects.toThrow();
 await expect(requestTrial(f.configured,operator,f.project,encode({...proposal(),wat:'a'.repeat(32769)}))).rejects.toThrow();
 await expect(requestTrial(f.configured,operator,f.project,encode({...proposal(),wat:'🧪'.repeat(10000)}))).rejects.toThrow();
});
it('HTTP retries preserve one experiment and exact original source, even after an interrupted workflow start',async()=>{
 const f=await fixture();await requestTrial(f.configured,operator,f.project,encode(f.source));expect(f.calls()).toBe(2);
 expect(await(await listTrials(env,operator,f.project)).json()).toMatchObject({trials:[{id:f.job.id,status:'requested'}]});
 expect(await(await readProposal(env,operator,f.project,f.job.id)).json()).toMatchObject({wat:f.source.wat,strategy:f.source.strategy});
 await expect(requestTrial(f.configured,operator,f.project,encode({...f.source,wat:'changed'}))).rejects.toThrow('different source');
 await env.ARTIFACTS.put(f.job.requestKey,'corrupted');await expect(readProposal(env,operator,f.project,f.job.id)).rejects.toThrow('corrupted');
});
it('private trials are invisible to unjoined administrators and read-only members cannot start runs',async()=>{
 const f=await fixture(),name='trialreader'+crypto.randomUUID().replaceAll('-','').slice(0,12);await env.DB.prepare('INSERT INTO native_users (username,salt,password_hash,role,created_at) VALUES (?,?,?,?,?)').bind(name,'test-salt','test-hash','admin',Date.now()).run();
 const admin={username:name,role:'admin',kind:'account'} as const;await expect(readTrial(env,admin,f.project,f.job.id)).rejects.toThrow('not found');
 await grant(env,operator,f.project,encode({username:name,role:'reader'}));expect((await readTrial(env,admin,f.project,f.job.id)).status).toBe(200);
 await expect(requestTrial(f.configured,admin,f.project,encode(proposal()))).rejects.toThrow('permission');
 await expect(readProposal(env,operator,'other-project',f.job.id)).rejects.toThrow('not found');
});
it('daily registration and actual assembly/archive container budgets are independent and bounded',async()=>{
 const name='trialbudget-'+crypto.randomUUID();for(let i=0;i<8;i++){expect(await coordinate(env,name,'observatory-register',{id:String(i)})).toEqual({allowed:true});expect(await coordinate(env,name,'observatory-register',{id:String(i)})).toEqual({allowed:true});}
 expect(await coordinate(env,name,'observatory-register',{id:'overflow'})).toEqual({allowed:false});for(let i=0;i<16;i++)expect(await coordinate(env,name,'observatory-container-budget')).toEqual({allowed:true});expect(await coordinate(env,name,'observatory-container-budget')).toEqual({allowed:false});
});
it('trusted publication binds project and experiment, repairs retries, and preserves prior native history',async()=>{
 const f=await fixture(),reportHash='b'.repeat(64),data=encode({content_hash:reportHash,report:{experiment:{id:f.job.experiment},config:{project:f.project}}}),digest=await sha256(data);
 const version={schema_version:1 as const,parents:[],kind:{kind:'evaluation' as const,report_hash:reportHash},message:'Trusted transport fixture only; no real candidate qualification',files:{'run/run.json':digest}},sealed={version,content_hash:await nativeHash(version)},bundle={sealed,objects:[{hash:digest,base64:btoa(String.fromCharCode(...data))}]};
 await expect(publishTrial(env,{...f.job,experiment:'EXP-other'},bundle)).rejects.toThrow('another experiment');await expect(publishTrial(env,f.job,{...bundle,objects:[]})).rejects.toThrow('incomplete');
 for(let i=0;i<2;i++)expect(await publishTrial(env,f.job,bundle)).toMatchObject({version:sealed.content_hash});
 expect(await(await readTrial(env,operator,f.project,f.job.id)).json()).toMatchObject({status:'completed',native_version:sealed.content_hash});
 expect(await coordinate(env,'NATIVE-STORE-'+f.project,'native-log')).toMatchObject({entries:[{version:sealed.content_hash}]});
});

it('repair restarts one failed workflow without replacing source or creating a second experiment',async()=>{
 const f=await fixture();await env.DB.prepare("UPDATE observatory_trials SET status = 'failed' WHERE id = ?").bind(f.job.id).run();let restarts=0;const configured={...env,OBSERVATORY_TRIALS:{get:async()=>({status:async()=>({status:'errored'}),restart:async()=>{restarts++;}})}} as unknown as Env;
 await retryTrial(configured,operator,f.project,f.job.id);await retryTrial(configured,operator,f.project,f.job.id);expect(restarts).toBe(1);expect(await(await readProposal(env,operator,f.project,f.job.id)).json()).toMatchObject({wat:f.source.wat});
});
