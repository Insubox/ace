import {beforeAll,it,expect} from 'vitest';
import {env,SELF} from 'cloudflare:test';
import actualRustReceipt from './fixtures/native-verification-receipt.json';
import nativeMigration from '../migrations/0003_native_stores.sql?raw';
import migration from '../migrations/0005_native_verifications.sql?raw';
import {type Env,coordinate,sha256} from '../src/contracts';
import {nativeHash,putObject,putVersion,appendEntry} from '../src/native-store';
import {completeVerification,readVerification,readVerifiedRun,requestVerification,receiptSchema,type VerificationJob} from '../src/verification';
const encode=(x:unknown)=>new TextEncoder().encode(JSON.stringify(x)),h='a'.repeat(64),verified='b'.repeat(64),verifier='f'.repeat(64);
beforeAll(async()=>{for(const raw of[nativeMigration,migration])await env.DB.batch(raw.split(';').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));});
async function fixture(){const store='verify-'+crypto.randomUUID();const bytes=encode({report:{},content_hash:h}),object=await sha256(bytes);
 const version={schema_version:1,parents:[],kind:{kind:'evaluation',report_hash:h},message:'isolated verification fixture',files:{'run/run.json':object}};
 const id=await nativeHash(version);await putObject(env,store,object,bytes);await putVersion(env,store,id,encode({version,content_hash:id}));
 await appendEntry(env,store,encode({schema_version:1,sequence:1,previous:null,version:id,content_hash:await nativeHash([1,1,null,id])}));
 const job:VerificationJob={store,version:id,verifier,workflow:'fixture-'+crypto.randomUUID()};
 await env.DB.prepare("INSERT INTO native_verifications (store,version,verifier,workflow,status,requested_at) VALUES (?,?,?,?,'requested',?)").bind(store,id,verifier,job.workflow,Date.now()).run();
 const receipt={schema_version:1,status:'reproduced',original_report_hash:h,snapshot_report_hash:h,original_environment_hash:h,verified_report_hash:verified,verified_environment_hash:verified,
 same_environment:false,harness_hash:h,champion:'C-a',champion_matches:true,source_count:2,evaluator_binary_hash:verifier,runtime:'fixture-runtime',scope:'Fixture trusted evaluator transport only.',
 candidates:[{candidate:'C-a',artifact_hash:h,claimed_outcome:'qualified',observed_outcome:'qualified',matched:true,evidence_hash:h,decision:{action:'elite'}},
 {candidate:'C-b',artifact_hash:verified,claimed_outcome:'failed_correctness',observed_outcome:'failed_correctness',matched:true,evidence_hash:verified,decision:{action:'kill',reason:'oracle_failed'}}]};
 const paths=['run.json','environment.json','intent.json','experiment.json','knowledge.json','champion.json',...receipt.candidates.flatMap(c=>['candidate','evaluation','evidence','decision'].map(k=>`candidates/${c.candidate}/${k}.json`))];
 const files=paths.map(path=>({path,content:JSON.stringify(path==='run.json'?{content_hash:verified,report:{}}:{fixture:true})}));
 return{job,receipt,files};}
it('verification requires authentication and never accepts a caller-supplied receipt',async()=>{
 const r=await SELF.fetch('https://ace/v1/stores/private/versions/'+h+'/verify',{method:'POST',body:JSON.stringify({status:'reproduced'})});expect(r.status).toBe(401);
 expect(()=>receiptSchema.parse({schema_version:1,status:'reproduced'})).toThrow();
 const f=await fixture();expect(()=>receiptSchema.parse({...f.receipt,candidates:[{...f.receipt.candidates[0],observed_outcome:'failed_correctness'},f.receipt.candidates[1]]})).toThrow();
 expect(()=>receiptSchema.parse({...f.receipt,candidates:[{...f.receipt.candidates[0],decision:{action:'champion'}},f.receipt.candidates[1]]})).toThrow();
});
it('server receipts bind the native version and the configured evaluator, with complete evidence',async()=>{
 const f=await fixture();await expect(completeVerification(env,f.job,JSON.stringify({...f.receipt,original_report_hash:verified}),f.files)).rejects.toThrow('bind');
 await expect(completeVerification(env,f.job,JSON.stringify({...f.receipt,evaluator_binary_hash:h}),f.files)).rejects.toThrow('bind');
 await expect(completeVerification(env,f.job,JSON.stringify(f.receipt),f.files.slice(0,-1))).rejects.toThrow('incomplete');
 expect(await(await readVerification(env,f.job.store,f.job.version)).json()).toMatchObject({status:'requested'});
});
it('retains verified evidence idempotently and detects receipt or completed-run corruption',async()=>{
 const f=await fixture();for(let i=0;i<2;i++)await completeVerification(env,f.job,JSON.stringify(f.receipt),f.files);
 const value=await(await readVerification(env,f.job.store,f.job.version)).json() as {status:string;receipt:unknown};expect(value).toMatchObject({status:'completed',receipt:f.receipt});
 expect(await(await readVerifiedRun(env,f.job.store,f.job.version)).json()).toMatchObject({content_hash:verified});
 const row=await env.DB.prepare('SELECT receipt_key FROM native_verifications WHERE store = ?').bind(f.job.store).first<{receipt_key:string}>();
 await env.ARTIFACTS.put(row!.receipt_key.replace(/receipt\.json$/,'run/run.json'),encode({corrupted:true}));
 await expect(readVerifiedRun(env,f.job.store,f.job.version)).rejects.toThrow('corrupted');
 await env.ARTIFACTS.put(row!.receipt_key,encode({corrupted:true}));await expect(readVerification(env,f.job.store,f.job.version)).rejects.toThrow('corrupted');
});
it('a failed partial run export can be retried with a distinct server run identity',async()=>{
 const f=await fixture();const broken={...env,ARTIFACTS:new Proxy(env.ARTIFACTS,{get(target,key){if(key==='put')return async()=>{throw new Error('interrupted export')};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}})} as Env;
 await expect(completeVerification(broken,f.job,JSON.stringify(f.receipt),f.files)).rejects.toThrow('interrupted');
 expect(await(await readVerification(env,f.job.store,f.job.version)).json()).toMatchObject({status:'requested'});
 const changed={...f.receipt,verified_report_hash:'c'.repeat(64)},files=f.files.map(f=>f.path==='run.json'?{...f,content:JSON.stringify({content_hash:changed.verified_report_hash,report:{}})}:f);
 await completeVerification(env,f.job,JSON.stringify(changed),files);expect(await(await readVerification(env,f.job.store,f.job.version)).json()).toMatchObject({status:'completed'});
});
it('verification cost reservations are bounded independently of model and candidate budgets',async()=>{
 const name='fixture-verification-budget-'+crypto.randomUUID();for(let i=0;i<8;i++)expect(await coordinate(env,name,'native-verify-budget')).toEqual({allowed:true});
 expect(await coordinate(env,name,'native-verify-budget')).toEqual({allowed:false});
});
it('requests repair workflow startup without creating duplicate verification rows',async()=>{
 const f=await fixture();await env.DB.prepare('DELETE FROM native_verifications WHERE store = ?').bind(f.job.store).run();let creates=0;
 const fixtureEnv={...env,NATIVE_VERIFICATIONS:{create:async()=>{creates++;return{};}}} as unknown as Env;
 for(let i=0;i<2;i++)expect((await requestVerification(fixtureEnv,f.job.store,f.job.version)).status).toBe(202);
 expect(creates).toBe(2);expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM native_verifications WHERE store = ?').bind(f.job.store).first()).toMatchObject({n:1});
});

it('accepts the receipt emitted by the actual isolated Rust evaluator',()=>{expect(receiptSchema.parse(actualRustReceipt)).toEqual(actualRustReceipt);});

it('preserves older completed receipts with their exact evaluator identity after an image upgrade',async()=>{
 const f=await fixture();await completeVerification(env,f.job,JSON.stringify(f.receipt),f.files);const upgraded={...env,NATIVE_VERIFIER_BINARY_HASH:'d'.repeat(64)};
 expect(await(await readVerification(upgraded,f.job.store,f.job.version)).json()).toMatchObject({status:'completed',verifier:f.job.verifier,current_evaluator:false});
 expect(await(await readVerifiedRun(upgraded,f.job.store,f.job.version)).json()).toMatchObject({content_hash:verified});
});

it('retry uses a new workflow and ignores superseded completion attempts',async()=>{
 const f=await fixture();await env.DB.prepare("UPDATE native_verifications SET status = 'failed' WHERE store = ?").bind(f.job.store).run();
 const fixtureEnv={...env,NATIVE_VERIFICATIONS:{create:async()=>({})}} as unknown as Env;
 expect((await requestVerification(fixtureEnv,f.job.store,f.job.version)).status).toBe(202);
 const row=await env.DB.prepare('SELECT workflow,status FROM native_verifications WHERE store = ?').bind(f.job.store).first<{workflow:string;status:string}>();
 expect(row!.workflow).not.toBe(f.job.workflow);expect(row!.status).toBe('requested');
 await expect(completeVerification(env,f.job,JSON.stringify(f.receipt),f.files)).rejects.toThrow('superseded');
 await completeVerification(env,{...f.job,workflow:row!.workflow},JSON.stringify(f.receipt),f.files);
 expect(await(await readVerification(env,f.job.store,f.job.version)).json()).toMatchObject({status:'completed'});
});
