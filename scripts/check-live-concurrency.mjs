// Bounded live CAS correctness probe in a dedicated native project. One operator,
// 20 contenders, no model/evaluator calls. This is not a throughput benchmark.
import assert from 'node:assert/strict';import {parseArgs} from 'node:util';import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';
import {settings,api,rawHash} from '../cloud/scripts/client.mjs';import {nativeHash} from '../cloud/scripts/native-wire.mjs';
const {values}=parseArgs({options:{run:{type:'boolean',default:false},output:{type:'string'}}});
assert(values.run&&values.output,'Pass --run --output private-file to create an isolated diagnostic project');
const config=settings(),name='ops-race-'+randomUUID(),start=Date.now(),path=`/v1/stores/${name}`;
await api(config,'/v1/projects',{method:'POST',body:JSON.stringify({name})});
const bytes=new TextEncoder().encode('ACE bounded publication concurrency diagnostic\n'),object=rawHash(bytes);await api(config,path+'/objects/'+object,{method:'PUT',body:bytes});
const publish=async i=>{const version={schema_version:1,parents:i?[base]:[],kind:{kind:'source'},message:'Diagnostic contender '+i,files:{'diagnostic.txt':object}},content_hash=nativeHash(version);await api(config,path+'/versions/'+content_hash,{method:'PUT',body:JSON.stringify({version,content_hash})});return content_hash;};
const base=await publish(0),entry=(sequence,previous,version)=>({schema_version:1,sequence,previous,version,content_hash:nativeHash([1,sequence,previous,version])}),first=entry(1,null,base);await api(config,path+'/journal',{method:'POST',body:JSON.stringify(first)});
const versions=[];for(let i=1;i<=20;i++)versions.push(await publish(i));
const outcomes=await Promise.allSettled(versions.map(version=>api(config,path+'/journal',{method:'POST',body:JSON.stringify(entry(2,first.content_hash,version))}).then(async r=>{await r.arrayBuffer();return version;})));
await writeFile(values.output+'.attempts.json',JSON.stringify({project:name,outcomes:outcomes.map(r=>r.status==='fulfilled'?{status:'accepted',version:r.value}:{status:'rejected',http:r.reason.status??null,error:r.reason.message})},null,2),{mode:0o600,flag:'wx'});
const success=outcomes.filter(r=>r.status==='fulfilled'),conflicts=outcomes.filter(r=>r.status==='rejected'&&r.reason.status===409);assert.equal(success.length,1);
const log=await(await api(config,path)).json();assert.equal(log.entries.length,2);assert.equal(log.entries[1].version,success[0].value);assert.equal(log.tip,entry(2,first.content_hash,success[0].value).content_hash);
const refs=await Promise.allSettled(Array.from({length:20},(_,i)=>{const branch='diagnostic-'+i,target=success[0].value;return api(config,path+'/refs',{method:'POST',body:JSON.stringify({schema_version:1,sequence:1,previous:null,branch,expected:null,target,content_hash:nativeHash([1,1,null,branch,null,target])})}).then(async r=>{await r.arrayBuffer();return branch;});}));
assert.equal(refs.filter(r=>r.status==='fulfilled').length,1);
const state=await(await api(config,path+'/refs')).json();assert.equal(state.events.length,1);assert.equal(Object.keys(state.heads).length,1);
const evidence={schema_version:1,project:name,observed_at:new Date().toISOString(),actor_count:1,concurrent_contenders:20,journal:{accepted:success.length,conflicts:conflicts.length,unexpected_http:outcomes.filter(r=>r.status==='rejected'&&r.reason.status!==409).map(r=>r.reason.status??'network'),hash_verified:true},refs:{accepted:refs.filter(r=>r.status==='fulfilled').length,conflicts:refs.filter(r=>r.status==='rejected'&&r.reason.status===409).length,unexpected_http:refs.filter(r=>r.status==='rejected'&&r.reason.status!==409).map(r=>r.reason.status??'network'),retained_heads:1},elapsed_ms:Date.now()-start,model_calls:0,evaluator_calls:0,scope:'Live correctness of native journal and reference compare-and-swap under one operator; no multi-user, sustained-load or throughput claim'};
await writeFile(values.output,JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(evidence));assert.equal(evidence.journal.conflicts,19);assert.equal(evidence.refs.conflicts,19);
