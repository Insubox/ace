import {it,expect} from 'vitest';
import {env,SELF} from 'cloudflare:test';
import {operations} from '../src/operations';
import {coordinate} from '../src/contracts';
import {ensure} from '../src/projects';
const operator={username:'operator',kind:'operator',role:'admin'} as const;

it('operational observations require infrastructure authority, including for account administrators',async()=>{
 expect((await SELF.fetch('https://ace/v1/operations')).status).toBe(401);
 for(const role of ['reader','writer','admin'] as const)await expect(operations(env,{username:'unjoined',kind:'account',role})).rejects.toThrow('infrastructure operator');
});

it('reads real counters without spending budget and reports stale restore and workflow signals',async()=>{
 const now=Date.now(),day=new Date(now).toISOString().slice(0,10),name='OBSERVATORY-BUDGET-'+day;
 await coordinate(env,name,'observatory-register',{id:'metrics-fixture'});
 await coordinate(env,name,'observatory-container-budget');
 await ensure(env,operator,'metrics-private');
 await env.DB.prepare("INSERT INTO observatory_trials (id,project,actor,request_hash,request_key,experiment,status,created_at,updated_at) VALUES ('metrics-trial','metrics-private','private-user','a','private-key','EXP-metrics','completed',?,?)").bind(now-7000,now-2000).run();
 await env.DB.prepare("INSERT INTO native_verifications (store,version,verifier,workflow,status,requested_at) VALUES ('private-store','b','c','metrics-verifier','running',?)").bind(now-100*60000).run();
 const before=await coordinate(env,name,'operational-budgets');
 const first=await(await operations(env,operator)).json() as Record<string,unknown>;
 await operations(env,operator);
 expect(await coordinate(env,name,'operational-budgets')).toEqual(before);
 expect(first).toMatchObject({completed_trial_duration_including_repairs:{count:1,mean_duration_ms:5000,max_duration_ms:5000},pending_verifications_over_90m:1,costs:null,observatory_budget:{trials_used:1,containers_used:1}});
 expect(first.alerts).toContain('verification_pending_over_90_minutes');expect(first.alerts).toContain('no_recent_sealed_backup_with_completed_restore_drill');
 expect(JSON.stringify(first)).not.toMatch(/private-user|private-key|metrics-private|private-store/);
});
