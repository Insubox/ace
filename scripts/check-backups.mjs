// Explicit --request creates one bounded private snapshot and an isolated drill.
// Default mode reads an existing backup; no account/session metadata is exported.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {settings,api} from '../cloud/scripts/client.mjs';
import {pullStore} from '../cloud/scripts/store-sync-driver.mjs';
const {values}=parseArgs({options:{wait:{type:'boolean',default:false},request:{type:'boolean',default:false},id:{type:'string'},store:{type:'string',default:'native-platform-v030'},output:{type:'string'},ace:{type:'string',default:'ace'}}});
const config=settings();let id=values.id;
if(values.request){assert(!id,'Choose --request or --id');id=(await(await api(config,'/v1/backups',{method:'POST'})).json()).id;console.log(JSON.stringify({backup:id,requested:true}));}
let row;
for(let i=0;i<720;i++){const list=await(await api(config,'/v1/backups')).json();row=list.backups.find(b=>id?b.id===id:b.status==='completed'&&b.restore_status==='completed');id??=row?.id;if(row?.status==='failed'||row?.restore_status==='failed')throw new Error('Backup/restore workflow failed; inspect infrastructure workflow');if(row?.status==='completed'&&row?.restore_status==='completed')break;if(!values.request&&!values.wait)throw new Error('No completed restoration drill; pass --request explicitly');await new Promise(done=>setTimeout(done,2500));}
assert.equal(row?.status,'completed');assert.equal(row?.restore_status,'completed');
const receipt=await(await api(config,`/v1/backups/${id}/restore`)).json();assert.equal(receipt.sessions_restored,0);assert.equal(receipt.production_writes,0);
let restored=null,replay=null;
if(values.output){const root=resolve(values.output);await mkdir(root);const directory=join(root,'native');const request=async(c,path,init={})=>{assert(!init.method||init.method==='GET','Drill transport is read only');assert(path.startsWith('/v1/stores/'));return api(c,`/v1/backups/${id}/restore`+path.slice(3),init);};restored=await pullStore({directory,name:values.store,config,binary:values.ace,request});
 const status=JSON.parse(execFileSync(values.ace,['store','log',directory],{encoding:'utf8',maxBuffer:16777216}));const evaluation=status.versions.find(v=>v.kind.kind==='evaluation');assert(evaluation,'Backup must retain evaluated learning');
 const snapshot=join(directory,'views',evaluation.version);const learning=JSON.parse(await readFile(join(snapshot,'learning.json'),'utf8'));assert(learning,'Native learning survived restore');
 replay=JSON.parse(execFileSync(values.ace,['cloud','verify-snapshot',snapshot,'--output',join(root,'replayed')],{encoding:'utf8',timeout:180000,maxBuffer:16777216}));assert.equal(replay.status,'reproduced');
 await writeFile(join(root,'validation.json'),JSON.stringify({backup:id,receipt,restored,replay},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({backup:id,status:row.status,restore_status:row.restore_status,objects:row.object_count,bytes:row.byte_count,receipt,restored,replay_status:replay?.status,production_source_mutations:0,session_exports:0}));
