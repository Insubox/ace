// Private disaster snapshots and isolated restoration drills. Sessions are excluded.
import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from 'cloudflare:workers';
import {z} from 'zod';
import {type Env,type ExperimentState,HttpError,json,sha256,coordinate,strictJson} from './contracts';
import {nativeHash,entrySchema,versionSchema,refSchema,type NativeRef,type NativeEntry} from './native-store';
import type {Review} from './review-state';
import type {Issue} from './issues';
import type {Identity} from './accounts';
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const tables=['experiments','evaluations','evidence_index','native_users','native_projects','native_project_members','project_resource_owners','project_artifacts','project_audit','account_audit','native_stores','native_verifications','observatory_trials','application_runs','application_campaigns','project_notifications','notification_reads'] as const;
const backupId=z.string().regex(/^backup-(?:[0-9]{8}|[0-9a-f-]{36})$/);
type Row=Record<string,string|number|null>;
type Table={name:string;sql:string;columns:string[];rows:Row[]};
type Log={entries:NativeEntry[];publishers:Record<string,{username:string;published_at:number}>;tip:string|null;reviews?:Review[];issues?:Issue[]};
type RefLog={events:NativeRef[];heads:Record<string,string>;tip:string|null};
type Inventory={schema_version:1;id:string;started_at:number;tables:Table[];stores:Record<string,Log>;refs?:Record<string,RefLog>;experiments:Record<string,ExperimentState>;keys:string[]};
type Item={key:string;hash:string;size:number};
type Manifest={schema_version:1;id:string;started_at:number;completed_at:number;inventory_hash:string;objects:Item[];sessions_excluded:true;consistency:'transactional_metadata_and_pinned_store_journals'};
export type BackupJob={id:string;restore?:boolean};
const authority=(actor:Identity)=>{if(actor.kind!=='operator')throw new HttpError(403,'infrastructure operator required');};
const requireBindings=(env:Env)=>{if(!env.BACKUPS||!env.RESTORE_STORAGE||!env.RESTORE_DB||!env.BACKUP_WORKFLOW||!env.RESTORE_COORDINATORS)throw new HttpError(503,'backup and isolated restore bindings are required');};
const prefix=(id:string)=>backupId.parse(id)+'/';
const restoreCoordinate=(env:Env,name:string,op:string,body:Record<string,unknown>={})=>coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},name,op,body);
export async function assertIsolated(env:Env){
 requireBindings(env);
 if(env.COORDINATORS.idFromName('ace-restore-isolation').toString()===env.RESTORE_COORDINATORS!.idFromName('ace-restore-isolation').toString())throw new Error('restore coordinator namespace must be independent');
 if(await env.RESTORE_DB!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('native_users','experiments','workspace_backups') LIMIT 1").first())throw new Error('restore database must contain no live application tables');
 const backup='isolation-probe/'+crypto.randomUUID(),restore='isolation-probe/'+crypto.randomUUID();
 try{await env.BACKUPS!.put(backup,'isolated');await env.RESTORE_STORAGE!.put(restore,'isolated');if(await env.ARTIFACTS.head(backup)||await env.ARTIFACTS.head(restore)||await env.BACKUPS!.head(restore)||await env.RESTORE_STORAGE!.head(backup))throw new Error('backup and restore buckets must be independent from live source and each other');}
 finally{await env.BACKUPS!.delete(backup);await env.RESTORE_STORAGE!.delete(restore);}
 return{isolated:true};
}
const normalized=(rows:Row[])=>rows.map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))))).sort();
async function retain(bucket:R2Bucket,key:string,bytes:Uint8Array){const digest=await sha256(bytes),old=await bucket.get(key);if(old){if(old.size!==bytes.length||await sha256(await old.arrayBuffer())!==digest)throw new Error('backup immutable destination differs');}else await bucket.put(key,bytes);return digest;}
async function checked(bucket:R2Bucket,key:string,digest:string){const object=await bucket.get(key);if(!object)throw new Error('backup file missing');const bytes=new Uint8Array(await object.arrayBuffer());if(await sha256(bytes)!==digest)throw new Error('backup hash differs');return bytes;}
export async function capture(env:Env,id:string):Promise<Inventory>{
 requireBindings(env);await assertIsolated(env);backupId.parse(id);const startedAt=Date.now();
 const previous=await env.BACKUPS!.get(prefix(id)+'inventory.json');if(previous){if(previous.size>8388608)throw new Error('backup inventory exceeds bounds');const retained=strictJson(await previous.text()) as Inventory;if(retained.id!==id||retained.schema_version!==1)throw new Error('backup inventory differs');return retained;}
 const names=tables.map(n=>"'"+n+"'").join(',');
 const statements=[env.DB.prepare(`SELECT name,sql FROM sqlite_master WHERE type = 'table' AND name IN (${names})`),...tables.flatMap(n=>[env.DB.prepare(`PRAGMA table_info(${n})`),env.DB.prepare(`SELECT * FROM ${n} LIMIT 10001`)])];
 const result=await env.DB.batch(statements),schemas=result[0]!.results as {name:string;sql:string}[],saved:Table[]=[];
 for(const [i,name]of tables.entries()){const rows=result[i*2+2]!.results as Row[];if(rows.length>10000)throw new Error('backup metadata exceeds supported row limit');const sql=schemas.find(s=>s.name===name)?.sql;if(!sql)throw new Error('backup schema missing');saved.push({name,sql,columns:(result[i*2+1]!.results as {name:string}[]).map(c=>c.name),rows});}
 const stores:Record<string,Log>={},refs:Record<string,RefLog>={},experiments:Record<string,ExperimentState>={};
 // Capture authoritative DO journals, even when a publication's D1 mirror lags.
 const projects=saved.find(t=>t.name==='native_projects')!.rows;
 if(projects.length>100)throw new Error('backup supports at most 100 projects');
 for(const project of projects){const name=String(project.name);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))continue;const {refs:reference,...log}=await coordinate(env,'NATIVE-STORE-'+name,'native-backup-authority') as Log&{refs:RefLog};if(log.entries.length||log.issues?.length||log.reviews?.length){stores[name]=log;refs[name]=reference;}}
 if(saved.find(t=>t.name==='experiments')!.rows.length>100)throw new Error('backup supports at most 100 experiments');
 for(const row of saved.find(t=>t.name==='experiments')!.rows){const state=await coordinate(env,String(row.id),'status') as ExperimentState;experiments[String(row.id)]=state;}
 const keys:string[]=[];let cursor:string|undefined,total=0;
 do{const page=await env.ARTIFACTS.list({limit:100,cursor});for(const object of page.objects){keys.push(object.key);total+=object.size;if(keys.length>10000||total>1073741824||object.size>8388608)throw new Error('backup exceeds supported immutable object bounds');}cursor=page.truncated?page.cursor:undefined;}while(cursor);
 keys.sort();
 // Native append can precede its R2 journal mirror; retain the captured entry as
 // metadata and rebuild it during restoration. Its referenced objects must exist.
 for(const [name,log]of Object.entries(stores))for(const entry of log.entries){if(!keys.includes(`native-stores/${name}/versions/${entry.version}.json`))throw new Error('captured native version is missing');}
 const inventory:Inventory={schema_version:1,id,started_at:startedAt,tables:saved,stores,refs,experiments,keys};
 const bytes=encode(inventory);if(bytes.length>8388608)throw new Error('backup inventory exceeds 8 MiB');await retain(env.BACKUPS!,prefix(id)+'inventory.json',bytes);return inventory;
}
export async function copyChunk(env:Env,id:string,keys:string[]){const items:Item[]=[];for(let i=0;i<keys.length;i+=4)items.push(...await Promise.all(keys.slice(i,i+4).map(async key=>{const source=await env.ARTIFACTS.get(key);if(!source||source.size>8388608)throw new Error('source object unavailable or oversized');const bytes=new Uint8Array(await source.arrayBuffer());const hash=await retain(env.BACKUPS!,prefix(id)+'objects/'+key,bytes);return{key,hash,size:bytes.length};})));return items;}

export async function seal(env:Env,inventory:Inventory,items:Item[]){
 const old=await env.BACKUPS!.get(prefix(inventory.id)+'manifest.json');
 const manifest:Manifest=old?strictJson(await old.text()) as Manifest:{schema_version:1,id:inventory.id,started_at:inventory.started_at,completed_at:Date.now(),inventory_hash:await sha256(encode(inventory)),objects:items,sessions_excluded:true,consistency:'transactional_metadata_and_pinned_store_journals'};
 if(items.length!==inventory.keys.length||new Set(items.map(i=>i.key)).size!==items.length)throw new Error('backup inventory is incomplete');
 if(encode(manifest).length>2097152)throw new Error('backup manifest exceeds 2 MiB');
 if(manifest.inventory_hash!==await sha256(encode(inventory))||JSON.stringify(manifest.objects)!==JSON.stringify(items))throw new Error('completed backup differs');
 const hash=await retain(env.BACKUPS!,prefix(inventory.id)+'manifest.json',encode(manifest));
 await env.DB.prepare("UPDATE workspace_backups SET status = 'completed', completed_at = ?,manifest_hash = ?,object_count = ?,byte_count = ?,error = NULL WHERE id = ?").bind(Date.now(),hash,items.length,items.reduce((sum,i)=>sum+i.size,0),inventory.id).run();return manifest;
}
async function load(env:Env,id:string){requireBindings(env);const row=await env.DB.prepare("SELECT manifest_hash FROM workspace_backups WHERE id = ? AND status = 'completed'").bind(backupId.parse(id)).first<{manifest_hash:string}>();if(!row)throw new HttpError(409,'no completed backup');const manifest=strictJson(new TextDecoder().decode(await checked(env.BACKUPS!,prefix(id)+'manifest.json',row.manifest_hash))) as Manifest;const inventory=strictJson(new TextDecoder().decode(await checked(env.BACKUPS!,prefix(id)+'inventory.json',manifest.inventory_hash))) as Inventory;if(manifest.id!==id||inventory.id!==id)throw new Error('backup identity differs');return{manifest,inventory};}
export async function restoreChunk(env:Env,id:string,items:Item[]){for(let i=0;i<items.length;i+=4)await Promise.all(items.slice(i,i+4).map(async item=>{const bytes=await checked(env.BACKUPS!,prefix(id)+'objects/'+item.key,item.hash);const native=/^native-stores\/[^/]+\/objects\/([0-9a-f]{64})$/.exec(item.key);if(native&&native[1]!==item.hash)throw new Error('backup native source identity differs');await retain(env.RESTORE_STORAGE!,prefix(id)+item.key,bytes);const restored=await checked(env.RESTORE_STORAGE!,prefix(id)+item.key,item.hash);if(restored.length!==item.size)throw new Error('restored object size differs');}));return{objects:items.length};}

const namespaceFor=async(id:string)=>'r_'+(await sha256(encode(id))).slice(0,16)+'_';
export async function restoreTable(env:Env,id:string,table:Table){const namespace=await namespaceFor(id);
 if(!(tables as readonly string[]).includes(table.name)||table.columns.some(c=>!/^\w+$/.test(c)))throw new Error('unsupported restored schema');let sql=table.sql;for(const name of tables)sql=sql.replace(new RegExp('\\b'+name+'\\b','g'),namespace+name);sql=sql.replace(/^CREATE TABLE(?: IF NOT EXISTS)? /i,'CREATE TABLE IF NOT EXISTS ');if(!/^CREATE TABLE IF NOT EXISTS /i.test(sql))throw new Error('unsupported restored schema');await env.RESTORE_DB!.prepare(sql).run();
  for(let start=0;start<table.rows.length;start+=40){const chunk=table.rows.slice(start,start+40);await env.RESTORE_DB!.batch(chunk.map(row=>env.RESTORE_DB!.prepare(`INSERT OR IGNORE INTO ${namespace+table.name} (${table.columns.join(',')}) VALUES (${table.columns.map(()=>'?').join(',')})`).bind(...table.columns.map(c=>row[c] as string|number|null))));}
  const actual=await env.RESTORE_DB!.prepare(`SELECT * FROM ${namespace+table.name}`).all<Row>();if(JSON.stringify(normalized(actual.results))!==JSON.stringify(normalized(table.rows)))throw new Error('restored metadata differs');

 return{name:table.name,rows:table.rows.length};
}
export async function restoreNative(env:Env,id:string,name:string,log:Log,items:Item[]){const objectMap=new Map(items.map(i=>[i.key,i]));
 
  let previous:string|null=null;const known=new Set<string>();
  for(const raw of log.entries){const entry=entrySchema.parse(raw);if(entry.previous!==previous||entry.sequence!==known.size+1||await nativeHash([entry.schema_version,entry.sequence,entry.previous,entry.version])!==entry.content_hash)throw new Error('restored journal differs');
   const file=await env.RESTORE_STORAGE!.get(prefix(id)+`native-stores/${name}/versions/${entry.version}.json`);if(!file)throw new Error('restored version missing');const sealed=versionSchema.parse(strictJson(await file.text()));if(sealed.content_hash!==entry.version||await nativeHash(sealed.version)!==entry.version||sealed.version.parents.some(p=>!known.has(p)))throw new Error('restored ancestry differs');
   for(const hash of new Set(Object.values(sealed.version.files))){const object=objectMap.get(`native-stores/${name}/objects/${hash}`);if(!object||object.hash!==hash)throw new Error('restored source object differs');}
   await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'native-restore',{entry,parents:sealed.version.parents,publisher:log.publishers[entry.version]});previous=entry.content_hash;known.add(entry.version);
  }
  if(log.reviews){await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'review-restore',{reviews:log.reviews});const actual=await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'review-list') as {reviews:Review[]};if(JSON.stringify(actual.reviews)!==JSON.stringify(log.reviews))throw new Error('restored reviews differ');}
  if(log.issues){if(log.issues.some(issue=>issue.version&&!known.has(issue.version)))throw new Error('restored task source is unpublished');await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'issue-restore',{issues:log.issues});const actual=await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'issue-list') as {issues:Issue[]};if(JSON.stringify(actual.issues)!==JSON.stringify(log.issues))throw new Error('restored tasks differ');}
  const observed=await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'native-log') as Log;if(observed.tip!==log.tip||JSON.stringify(observed.entries)!==JSON.stringify(log.entries)||JSON.stringify(observed.publishers)!==JSON.stringify(log.publishers))throw new Error('restored authority differs');

 return{name,versions:log.entries.length};
}
export async function restoreReferences(env:Env,id:string,name:string,reference:RefLog,log:Log,start=0){
 const parents=new Map<string,string[]>();for(const entry of log.entries){const file=await env.RESTORE_STORAGE!.get(prefix(id)+`native-stores/${name}/versions/${entry.version}.json`);if(!file)throw new Error('reference ancestry missing');const sealed=versionSchema.parse(strictJson(await file.text()));if(await nativeHash(sealed.version)!==entry.version)throw new Error('reference ancestry changed');parents.set(entry.version,sealed.version.parents);}
 for(const raw of reference.events.slice(start,start+100)){const event=refSchema.parse(raw);if(await nativeHash([1,event.sequence,event.previous,event.branch,event.expected,event.target])!==event.content_hash||!parents.has(event.target))throw new Error('restored reference differs');if(event.expected){const next=[event.target],seen=new Set<string>();while(next.length){const target=next.pop()!;if(seen.has(target))continue;seen.add(target);next.push(...(parents.get(target)??[]));}if(!seen.has(event.expected))throw new Error('restored reference is not a fast-forward');}await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'native-ref-append',{ref:event});}
 if(start+100>=reference.events.length){const actual=await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'native-refs') as RefLog;if(actual.tip!==reference.tip||JSON.stringify(actual.events)!==JSON.stringify(reference.events)||JSON.stringify(actual.heads)!==JSON.stringify(reference.heads))throw new Error('restored branch references differ');}
 return{reference_events:Math.min(100,reference.events.length-start)};
}
export async function restoreExperiment(env:Env,id:string,name:string,state:ExperimentState){
 const restored={...state,tasks:state.tasks.map(({token,leaseUntil,...task})=>task),finalizer:(({token,leaseUntil,...task})=>task)(state.finalizer)};if(!['completed','failed'].includes(restored.status)){restored.status='failed';restored.error='Interrupted by disaster recovery; no code-failure conclusion.';}await restoreCoordinate(env,'RESTORE-'+id+'-EXPERIMENT-'+name,'experiment-restore',{state:restored});const actual=await restoreCoordinate(env,'RESTORE-'+id+'-EXPERIMENT-'+name,'status') as ExperimentState;if(JSON.stringify(actual)!==JSON.stringify(restored))throw new Error('restored experiment state differs');
 return{name,restored:true};
}
async function restoreSummary(id:string,inventory:Inventory){
 return{namespace:await namespaceFor(id),tables:inventory.tables.map(t=>({name:t.name,rows:t.rows.length})),stores:Object.keys(inventory.stores).length,experiments:Object.keys(inventory.experiments).length,sessions_restored:0,password_hashes_retained:true,production_writes:0,branches:Object.values(inventory.refs??{}).reduce((sum,r)=>sum+Object.keys(r.heads).length,0)};
}
export async function restoreMetadata(env:Env,id:string,inventory:Inventory,items:Item[]){for(const table of inventory.tables)await restoreTable(env,id,table);for(const [name,log]of Object.entries(inventory.stores))await restoreNative(env,id,name,log,items);for(const [name,refs]of Object.entries(inventory.refs??{}))for(let i=0;i<refs.events.length;i+=100)await restoreReferences(env,id,name,refs,inventory.stores[name]!,i);for(const [name,state]of Object.entries(inventory.experiments))await restoreExperiment(env,id,name,state);return restoreSummary(id,inventory);}

export async function requestBackup(env:Env,actor:Identity,id='backup-'+crypto.randomUUID()){
 authority(actor);requireBindings(env);backupId.parse(id);const inserted=await env.DB.prepare("INSERT INTO workspace_backups (id,status,created_at) VALUES (?,'requested',?) ON CONFLICT(id) DO NOTHING").bind(id,Date.now()).run();
 if(inserted.meta.changes===1){const budget=await coordinate(env,'BACKUP-BUDGET-'+new Date().toISOString().slice(0,10),'backup-budget') as {allowed:boolean};if(!budget.allowed){await env.DB.prepare("UPDATE workspace_backups SET status = 'failed',error = 'Daily backup budget exhausted' WHERE id = ?").bind(id).run();throw new HttpError(429,'daily backup limit reached');}}
 try{await env.BACKUP_WORKFLOW!.create({id,params:{id}});}catch{const instance=await env.BACKUP_WORKFLOW!.get(id);await instance.status();}
 return json({id,created:inserted.meta.changes===1},202);
}
export async function listBackups(env:Env,actor:Identity){authority(actor);return json({backups:(await env.DB.prepare('SELECT * FROM workspace_backups ORDER BY created_at DESC LIMIT 30').all()).results,scope:'infrastructure_operator',retention:'manual_deletion_only'});}
export async function requestRestore(env:Env,actor:Identity,id:string){authority(actor);await load(env,id);const workflow='restore-'+backupId.parse(id);try{await env.BACKUP_WORKFLOW!.create({id:workflow,params:{id,restore:true}});}catch{await(await env.BACKUP_WORKFLOW!.get(workflow)).status();}return json({id,workflow,isolated:true},202);}
export async function readRestoreReceipt(env:Env,actor:Identity,id:string){authority(actor);requireBindings(env);const row=await env.DB.prepare("SELECT restore_hash FROM workspace_backups WHERE id = ? AND restore_status = 'completed'").bind(backupId.parse(id)).first<{restore_hash:string}>();if(!row)throw new HttpError(409,'restoration drill is not complete');return new Response(await checked(env.RESTORE_STORAGE!,prefix(id)+'restore-receipt.json',row.restore_hash),{headers:{'content-type':'application/json'}});}
export async function readDrill(env:Env,actor:Identity,id:string,name:string,kind?:string,hash?:string){authority(actor);const {inventory}=await load(env,id);if(!inventory.stores[name])throw new HttpError(404,'restored store missing');if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))throw new HttpError(400,'invalid native name');const row=await env.DB.prepare("SELECT restore_status FROM workspace_backups WHERE id = ?").bind(id).first<{restore_status:string}>();if(row?.restore_status!=='completed')throw new HttpError(409,'restoration drill is not complete');if(kind==='refs')return json(await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'native-refs'));if(!kind)return json(await restoreCoordinate(env,'RESTORE-'+id+'-NATIVE-'+name,'native-log'));if(!hash||!/^[0-9a-f]{64}$/.test(hash)||!['objects','versions'].includes(kind))throw new HttpError(400,'invalid restored file');const object=await env.RESTORE_STORAGE!.get(prefix(id)+`native-stores/${name}/${kind}/${hash}${kind==='versions'?'.json':''}`);if(!object)throw new HttpError(404,'restored file missing');return new Response(object.body,{headers:{'content-type':'application/octet-stream'}});}
export class BackupWorkflow extends WorkflowEntrypoint<Env,BackupJob>{
 async run(event:WorkflowEvent<BackupJob>,step:WorkflowStep){const {id,restore}=event.payload;
  try{await step.do('verify independent disaster resources',()=>assertIsolated(this.env));if(!restore){const reference=await step.do('capture transactional metadata and journals',async()=>{const inventory=await capture(this.env,id);return{hash:await sha256(encode(inventory))};});const inventory=strictJson(new TextDecoder().decode(await checked(this.env.BACKUPS!,prefix(id)+'inventory.json',reference.hash))) as Inventory;const items:Item[]=[];for(let i=0;i<inventory.keys.length;i+=20){items.push(...await step.do('copy immutable objects '+i,()=>copyChunk(this.env,id,inventory.keys.slice(i,i+20))));if((i+20)%100===0)await step.sleep('yield after source objects '+i,'30 seconds');}await step.do('seal complete snapshot',async()=>{await seal(this.env,inventory,items);return{sealed:true};});await step.do('start independent restoration workflow',async()=>{await requestRestore(this.env,{kind:'operator',username:'operator',role:'admin'},id);return{started:true};});return{backup:id,restore_started:true};}
   const reference=await step.do('load completed snapshot',async()=>{const {manifest}=await load(this.env,id);return{hash:await sha256(encode(manifest))};});const manifest=strictJson(new TextDecoder().decode(await checked(this.env.BACKUPS!,prefix(id)+'manifest.json',reference.hash))) as Manifest,inventory=strictJson(new TextDecoder().decode(await checked(this.env.BACKUPS!,prefix(id)+'inventory.json',manifest.inventory_hash))) as Inventory;await step.do('start isolated restoration',async()=>{await this.env.DB.prepare("UPDATE workspace_backups SET restore_status = 'running' WHERE id = ?").bind(id).run();return{started:true};});
   for(let i=0;i<manifest.objects.length;i+=20){await step.do('restore and verify objects '+i,()=>restoreChunk(this.env,id,manifest.objects.slice(i,i+20)));if((i+20)%100===0)await step.sleep('yield after restored objects '+i,'30 seconds');}
   for(const table of inventory.tables)await step.do('restore relational table '+table.name,()=>restoreTable(this.env,id,table));
   for(const [name,log]of Object.entries(inventory.stores))await step.do('restore native authority '+name,{timeout:'15 minutes'},()=>restoreNative(this.env,id,name,log,manifest.objects));
   for(const [name,refs]of Object.entries(inventory.refs??{}))for(let i=0;i<refs.events.length;i+=100)await step.do('restore branch references '+name+' '+i,()=>restoreReferences(this.env,id,name,refs,inventory.stores[name]!,i));
   for(const [name,state]of Object.entries(inventory.experiments))await step.do('restore experiment '+name,()=>restoreExperiment(this.env,id,name,state));
   const result=await restoreSummary(id,inventory);
   await step.do('seal restored drill',async()=>{const report={id,...result,objects:manifest.objects.length,bytes:manifest.objects.reduce((sum,o)=>sum+o.size,0),verified_at:Date.now()};const previous=await this.env.RESTORE_STORAGE!.get(prefix(id)+'restore-receipt.json');const hash=previous?await sha256(await previous.arrayBuffer()):await retain(this.env.RESTORE_STORAGE!,prefix(id)+'restore-receipt.json',encode(report));await this.env.DB.prepare("UPDATE workspace_backups SET restore_status = 'completed',restore_hash = ?,error = NULL WHERE id = ?").bind(hash,id).run();return report;});return{backup:id,restored:true};
  }catch(error){await step.do('record infrastructure failure',async()=>{await this.env.DB.prepare("UPDATE workspace_backups SET status = CASE WHEN status = 'completed' THEN status ELSE 'failed' END,restore_status = 'failed',error = 'Backup or isolated restoration could not finish; inspect workflow' WHERE id = ?").bind(id).run();});throw error;}
 }
}
