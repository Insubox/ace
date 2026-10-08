// Creates two dedicated probe accounts and a diagnostic project. No paid calls.
// Sessions are revoked in finally; account/audit history remains identifiable.
import {parseArgs} from 'node:util';import {randomUUID,randomBytes} from 'node:crypto';
import {settings,api,rawHash} from '../cloud/scripts/client.mjs';import {nativeHash} from '../cloud/scripts/native-wire.mjs';
import {writePrivateState} from '../cloud/scripts/lib/private-state.mjs';
const {values}=parseArgs({options:{run:{type:'boolean',default:false},output:{type:'string'}}});
if(!values.run||!values.output)throw Error('Use --run --output fresh-private-file to create dedicated probe accounts and project');
const operator=settings(),sessions=[],accounts=[],project='users-race-'+randomUUID(),start=Date.now(),path='/v1/stores/'+project;
const batch=async requests=>{const results=await Promise.allSettled(requests),counts={};for(const r of results){const code=r.status==='fulfilled'?200:r.reason.status??'transport';counts[code]=(counts[code]??0)+1;}return{results,counts};};
try{
 for(const role of ['writer','reader']){
  const username='ops-'+role+'-'+randomUUID().slice(0,8),password=randomBytes(24).toString('hex');
  await api(operator,'/v1/users',{method:'POST',body:JSON.stringify({username,password,role})});
  const login=await fetch(operator.origin+'/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!login.ok)throw Error('Dedicated probe sign-in failed HTTP '+login.status);const token=(await login.json()).token,config={...operator,token};sessions.push(config);accounts.push({username,role});
 }
 const [writer,reader]=sessions;await api(writer,'/v1/projects',{method:'POST',body:JSON.stringify({name:project})});await api(writer,`/v1/projects/${project}/members`,{method:'POST',body:JSON.stringify({username:accounts[1].username,role:'reader'})});
 const bytes=Buffer.from('Bounded multi-user native consistency probe\n'),object=rawHash(bytes);await api(writer,path+'/objects/'+object,{method:'PUT',body:bytes});
 const version=async i=>{const v={schema_version:1,parents:[],kind:{kind:'source'},message:'Contender '+i,files:{'diagnostic.txt':object}},id=nativeHash(v);await api(writer,path+'/versions/'+id,{method:'PUT',body:JSON.stringify({version:v,content_hash:id})});return id;};
 const versions=[];for(let i=0;i<20;i++)versions.push(await version(i));
 const entry=id=>({schema_version:1,sequence:1,previous:null,version:id,content_hash:nativeHash([1,1,null,id])});
 const writes=await batch(versions.map(v=>api(writer,path+'/journal',{method:'POST',body:JSON.stringify(entry(v)),signal:AbortSignal.timeout(15000)}).then(async r=>{await r.arrayBuffer();return v;})));
 const retained=await(await api(writer,path)).json(),winner=writes.results.find(r=>r.status==='fulfilled')?.value;
 const retries=winner?await batch(Array.from({length:20},()=>api(writer,path+'/journal',{method:'POST',body:JSON.stringify(entry(winner)),signal:AbortSignal.timeout(15000)}).then(r=>r.arrayBuffer()))):{counts:{}};
 const reads=await batch(Array.from({length:40},(_,i)=>api(i%2?writer:reader,path,{signal:AbortSignal.timeout(15000)}).then(r=>r.arrayBuffer())));
 let reader_write;try{await api(reader,path+'/journal',{method:'POST',body:JSON.stringify(entry(versions[1]))});reader_write=200;}catch(error){reader_write=error.status??'transport';}
 const evidence={schema_version:1,project,actors:accounts,concurrent_reads:40,reads:reads.counts,journal:writes.counts,identical_retries:retries.counts,reader_write,retained_versions:retained.entries.length,tip_hash_verified:retained.entries.length===1&&retained.entries[0].version===winner&&retained.tip===entry(winner).content_hash,duration_ms:Date.now()-start,paid_model_calls:0,paid_evaluator_calls:0,scope:'Bounded real account-session reads and native journal CAS. No sustained throughput, cloud evaluator capacity or uptime claim.'};
 await writePrivateState(values.output,evidence,{create:true});console.log(JSON.stringify(evidence));
 if(writes.counts[200]!==1||writes.counts[409]!==19||retries.counts[200]!==20||reads.counts[200]!==40||reader_write!==403||!evidence.tip_hash_verified)process.exitCode=1;
}finally{for(const config of sessions){try{await api(config,'/v1/auth/logout',{method:'POST'});}catch{console.error('Probe session revocation failed; investigate the dedicated probe account.');process.exitCode=1;}}}
