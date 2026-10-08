import {it,expect,beforeEach} from 'vitest';
import {env,SELF} from 'cloudflare:test';
import {capture,copyChunk,seal,restoreChunk,restoreMetadata,restoreExperiment,requestBackup,assertIsolated} from '../src/backups';
import {ensure} from '../src/projects';
import {putObject,putVersion,appendEntry,appendRef,nativeHash} from '../src/native-store';
import {sha256,coordinate} from '../src/contracts';
const operator={username:'operator',role:'admin',kind:'operator'} as const;
beforeEach(async()=>{for(const table of ['project_audit','native_project_members','project_resource_owners','project_artifacts','native_stores','native_projects'])await env.DB.prepare('DELETE FROM '+table).run();let cursor:string|undefined;do{const list=await env.ARTIFACTS.list({cursor});for(const item of list.objects)await env.ARTIFACTS.delete(item.key);cursor=list.truncated?list.cursor:undefined;}while(cursor);});
const encode=(v:unknown)=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v));
async function fixture(){
 const name='restore-'+crypto.randomUUID(),id='backup-'+crypto.randomUUID(),source=encode('original source learning fixture'),hash=await sha256(source);await ensure(env,operator,name);await putObject(env,name,hash,source);
 const version={schema_version:1,parents:[],kind:{kind:'source'},message:'Original native fixture',files:{'source.txt':hash}},versionHash=await nativeHash(version);await putVersion(env,name,versionHash,encode({version,content_hash:versionHash}));
 const entry={schema_version:1,sequence:1,previous:null,version:versionHash,content_hash:await nativeHash([1,1,null,versionHash])};await appendEntry(env,name,encode(entry),'original-owner');const ref={schema_version:1,sequence:1,previous:null,branch:'main',expected:null,target:versionHash,content_hash:await nativeHash([1,1,null,'main',null,versionHash])};await appendRef(env,name,encode(ref));
 await env.DB.prepare("INSERT INTO workspace_backups (id,status,created_at) VALUES (?,'requested',?)").bind(id,Date.now()).run();
 const username='recovery-'+crypto.randomUUID().slice(0,8);await env.DB.prepare("INSERT INTO native_users (username,role,salt,password_hash,created_at) VALUES (?,'writer',?,?,?)").bind(username,'c'.repeat(32),'d'.repeat(64),Date.now()).run();await env.DB.prepare('INSERT INTO native_sessions (token_hash,username,expires_at) VALUES (?,?,?)').bind(await sha256(encode(username)),username,Date.now()+10000).run();await env.DB.prepare('INSERT INTO native_recovery_tickets (username,code_hash,expires_at) VALUES (?,?,?)').bind(username,'e'.repeat(64),Date.now()+10000).run();
 const inventory=await capture(env,id),items=await copyChunk(env,id,inventory.keys),manifest=await seal(env,inventory,items);return{id,name,source,hash,versionHash,entry,inventory,items,manifest};
}
it('restores exact source, native authority and relational metadata after originals are unavailable',async()=>{
 const f=await fixture();
 expect(JSON.stringify(f.inventory)).toContain('d'.repeat(64));expect(JSON.stringify(f.inventory)).not.toContain('e'.repeat(64));
 expect(f.inventory.tables.map(t=>t.name)).not.toContain('native_sessions');expect(f.inventory.tables.map(t=>t.name)).not.toContain('native_recovery_tickets');
 for(const item of f.items)await env.ARTIFACTS.delete(item.key);
 await restoreChunk(env,f.id,f.items);const result=await restoreMetadata(env,f.id,f.inventory,f.items);expect(result).toMatchObject({sessions_restored:0,production_writes:0,password_hashes_retained:true});
 const object=await env.RESTORE_STORAGE!.get(f.id+`/native-stores/${f.name}/objects/${f.hash}`);expect(await object?.text()).toBe(new TextDecoder().decode(f.source));
 const log=await coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},'RESTORE-'+f.id+'-NATIVE-'+f.name,'native-log') as {tip:string;publishers:Record<string,unknown>};expect(log.tip).toBe(f.entry.content_hash);expect(log.publishers[f.versionHash]).toMatchObject({username:'original-owner'});expect((await coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},'RESTORE-'+f.id+'-NATIVE-'+f.name,'native-refs') as {heads:Record<string,string>}).heads.main).toBe(f.versionHash);
 await restoreChunk(env,f.id,f.items);expect(await restoreMetadata(env,f.id,f.inventory,f.items)).toEqual(result);
 expect(await env.RESTORE_DB!.prepare(`SELECT name FROM ${result.namespace}native_projects WHERE name = ?`).bind(f.name).first()).toMatchObject({name:f.name});
});
it('rejects missing or corrupted copies and never repairs by accepting changed bytes',async()=>{
 const f=await fixture(),item=f.items.find(i=>i.key.endsWith('/objects/'+f.hash))!;
 await env.BACKUPS!.put(f.id+'/objects/'+item.key,encode('altered backup'));await expect(restoreChunk(env,f.id,[item])).rejects.toThrow('hash differs');
 expect(await env.RESTORE_STORAGE!.get(f.id+'/'+item.key)).toBeNull();
});
it('rejects forged source identities even when the backup manifest matches the changed object',async()=>{
 const f=await fixture(),item=f.items.find(i=>i.key.endsWith('/objects/'+f.hash))!,changed=encode('rehash does not change native ancestry');const fake={...item,hash:await sha256(changed),size:changed.length};
 await env.BACKUPS!.put(f.id+'/objects/'+item.key,changed);await expect(restoreChunk(env,f.id,[fake])).rejects.toThrow('native source identity');
});
it('does not expose global backups to account administrators or unauthenticated requests',async()=>{
 const token='local-tests-only-0123456789abcdef0123456789abcdef';
 expect((await SELF.fetch('https://ace/v1/backups')).status).toBe(401);
 await expect(requestBackup(env,{username:'test-admin',role:'admin',kind:'account'})).rejects.toThrow('operator');
 expect((await SELF.fetch('https://ace/v1/backups',{headers:{authorization:'Bearer '+token}})).status).toBe(200);
});
it('restored experiment identities cannot collide with customer-controlled live coordinator names',async()=>{
 const f=await fixture(),liveName='RESTORE-'+f.id+'-NATIVE-'+f.name;await coordinate(env,liveName,'init',{experiment:liveName,project:'other',planHash:'d'.repeat(64),count:2});
 await restoreChunk(env,f.id,f.items);await restoreMetadata(env,f.id,f.inventory,f.items);
 const live=await coordinate(env,liveName,'status') as {project:string};expect(live.project).toBe('other');
});

it('restoration interrupts unfinished work and excludes live evaluator leases',async()=>{
 const id='backup-'+crypto.randomUUID(),name='recover-exp-'+crypto.randomUUID(),planHash='f'.repeat(64);
 await coordinate(env,name,'init',{experiment:name,project:'pending-project',planHash,count:2});
 await coordinate(env,name,'claim',{experiment:name,planHash,index:0});
 const original=await coordinate(env,name,'status') as import('../src/contracts').ExperimentState;expect(original.tasks[0]!.token).toBeTruthy();
 await restoreExperiment(env,id,name,original);
 const restored=await coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},'RESTORE-'+id+'-EXPERIMENT-'+name,'status') as import('../src/contracts').ExperimentState;
 expect(restored.status).toBe('failed');expect(restored.error).toContain('no code-failure conclusion');expect(restored.tasks[0]!.token).toBeUndefined();expect(restored.tasks[0]!.leaseUntil).toBeUndefined();
 expect((await coordinate(env,name,'status') as import('../src/contracts').ExperimentState).status).toBe(original.status);
});

it('fails closed when restoration bindings alias live databases, buckets or coordinator namespaces',async()=>{
 await expect(assertIsolated({...env,RESTORE_DB:env.DB})).rejects.toThrow('no live application tables');
 await expect(assertIsolated({...env,RESTORE_STORAGE:env.ARTIFACTS})).rejects.toThrow('buckets must be independent');
 await expect(assertIsolated({...env,BACKUPS:env.RESTORE_STORAGE})).rejects.toThrow('buckets must be independent');
 await expect(assertIsolated({...env,RESTORE_COORDINATORS:env.COORDINATORS})).rejects.toThrow('namespace must be independent');
 expect((await env.ARTIFACTS.list({prefix:'isolation-probe/'})).objects).toHaveLength(0);
});

it('restores review requests and their comments together with pinned native branch authority',async()=>{
 const f=await fixture();
 const version={schema_version:1,parents:[f.versionHash],kind:{kind:'source'},message:'review feature',files:{'source.txt':f.hash}},source=await nativeHash(version);await putVersion(env,f.name,source,encode({version,content_hash:source}));const entry={schema_version:1,sequence:2,previous:f.entry.content_hash,version:source,content_hash:await nativeHash([1,2,f.entry.content_hash,source])};await appendEntry(env,f.name,encode(entry));const refs=await coordinate(env,'NATIVE-STORE-'+f.name,'native-refs') as {tip:string};const ref={schema_version:1,sequence:2,previous:refs.tip,branch:'feature',expected:null,target:source,content_hash:await nativeHash([1,2,refs.tip,'feature',null,source])};await appendRef(env,f.name,encode(ref));
 const {createReview,reviewEvent}=await import('../src/collaboration');const reviewId=crypto.randomUUID();await createReview(env,operator,f.name,encode({id:reviewId,title:'Retain this discussion',source_branch:'feature',target_branch:'main',source,target:f.versionHash}));await reviewEvent(env,operator,f.name,reviewId,encode({id:crypto.randomUUID(),type:'comment',body:'Keep this exact learning',revision:1,source,target:f.versionHash}));
 const id='backup-'+crypto.randomUUID(),inventory=await capture(env,id),items=await copyChunk(env,id,inventory.keys);await restoreChunk(env,id,items);await restoreMetadata(env,id,inventory,items);const restored=await coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},'RESTORE-'+id+'-NATIVE-'+f.name,'review-get',{id:reviewId}) as {events:{body:string}[]};expect(restored.events[0]!.body).toBe('Keep this exact learning');
});
