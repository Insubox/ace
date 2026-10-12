import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pullStore} from '../store-sync-driver.mjs';
import {nativeHash} from '../native-wire.mjs';
import {rawHash} from '../client.mjs';
async function fixture(t){
 const parent=await mkdtemp(join(tmpdir(),'ace-resume-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const objects=[Buffer.from('first'),Buffer.from('second')],ids=objects.map(rawHash);
 const version={schema_version:1,parents:[],kind:{kind:'source'},message:'resume fixture',files:{a:ids[0],b:ids[1]}},id=nativeHash(version);
 const entry={schema_version:1,sequence:1,previous:null,version:id,content_hash:nativeHash([1,1,null,id])};
 const log={schema_version:1,backend:'ace-native-v1',entries:[entry],tip:entry.content_hash};
 const refs={schema_version:1,events:[],heads:{},tip:null};
 const calls=[];let fail=true;
 const options={directory:join(parent,'store'),name:'demo',config:{origin:'https://example.test',project:'one',token:'not-persisted'},run:()=>({backend:'ace-native-v1',verified:true,tip:log.tip}),request:async(_config,path)=>{
  calls.push(path);if(path.endsWith('/refs'))return Response.json(refs);
  if(path.endsWith('/demo'))return Response.json(log);
  if(path.includes('/versions/'))return Response.json({version,content_hash:id});
  const index=ids.indexOf(path.split('/').at(-1));assert.notEqual(index,-1);
  if(index===1&&fail){const error=new Error('Authentication interrupted');error.status=401;throw error;}
  return new Response(objects[index]);
 }};
 return {parent,options,calls,ids,id,log,refs,finish:()=>{fail=false;},objects};
}
test('401 stops once; explicit resume reuses verified objects and counts their bytes',async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options),{status:401});
 assert.equal(f.calls.filter(p=>p.endsWith(f.ids[1])).length,1);
 const marker=await readFile(join(f.options.directory,'.ace-pull.json'),'utf8');assert.ok(!marker.includes('not-persisted'));
 await assert.rejects(pullStore(f.options),{code:'EEXIST'});
 f.finish();f.calls.length=0;const result=await pullStore({...f.options,resume:true});
 assert.equal(result.bytes,11);assert.equal(result.objects,2);assert.ok(!f.calls.some(p=>p.endsWith(f.ids[0])));
 await assert.rejects(readFile(join(f.options.directory,'.ace-pull.json')),{code:'ENOENT'});
});
for(const field of ['origin','project'])test(`resume refuses changed ${field}`,async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options));f.finish();
 await assert.rejects(pullStore({...f.options,resume:true,config:{...f.options.config,[field]:'changed'}}),/origin, project/);
});
test('resume refuses pinned journal and reference changes',async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options));f.finish();
 const event={schema_version:1,sequence:1,previous:null,branch:'main',expected:null,target:f.id};event.content_hash=nativeHash([1,1,null,'main',null,f.id]);
 f.refs.events.push(event);f.refs.heads.main=f.id;f.refs.tip=event.content_hash;
 await assert.rejects(pullStore({...f.options,resume:true}),/references changed/);
 f.refs.events=[];f.refs.heads={};f.refs.tip=null;f.log.entries=[];f.log.tip=null;
 await assert.rejects(pullStore({...f.options,resume:true}),/journal or references changed/);
});
for(const mode of ['tamper','symlink'])test(`resume rejects ${mode} of cached objects`,async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options));f.finish();const path=join(f.options.directory,'objects',f.ids[0]);
 if(mode==='tamper')await writeFile(path,'corrupt');else{await rm(path);await symlink(join(f.parent,'outside'),path);await writeFile(join(f.parent,'outside'),f.objects[0]);}
 await assert.rejects(pullStore({...f.options,resume:true}),/hash differs|escapes/);
});
test('resume rejects altered cached canonical version before writing journal',async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options));f.finish();
 await writeFile(join(f.options.directory,'versions',`${f.id}.json`),JSON.stringify({content_hash:f.id,version:{files:{}}}));
 await assert.rejects(pullStore({...f.options,resume:true}),/version differs/);
});
test('403 also stops without retry',async t=>{
 const f=await fixture(t);const request=f.options.request;f.options.request=async(...args)=>{try{return await request(...args);}catch(error){error.status=403;throw error;}};
 await assert.rejects(pullStore(f.options),{status:403});assert.equal(f.calls.filter(p=>p.endsWith(f.ids[1])).length,1);
});
test('remote references changing during completion prevent verification',async t=>{
 const f=await fixture(t);f.finish();const original=f.options.request;let refsReads=0,verified=false;
 f.options.run=()=>{verified=true;throw Error('must not verify a moving snapshot');};
 f.options.request=async(...args)=>{if(args[1].endsWith('/refs')&&++refsReads===2){const event={schema_version:1,sequence:1,previous:null,branch:'main',expected:null,target:f.id};event.content_hash=nativeHash([1,1,null,'main',null,f.id]);return Response.json({schema_version:1,events:[event],heads:{main:f.id},tip:event.content_hash});}return original(...args);};
 await assert.rejects(pullStore(f.options),/references changed during pull/);assert.equal(verified,false);
});
test('explicit interrupted resume passes the real native verifier',{skip:!process.env.ACE_TEST_BINARY},async t=>{
 const {execFileSync}=await import('node:child_process');const f=await fixture(t);
 f.options.run=(_binary,args)=>JSON.parse(execFileSync(process.env.ACE_TEST_BINARY,args,{encoding:'utf8'}));
 await assert.rejects(pullStore(f.options),{status:401});f.finish();assert.equal((await pullStore({...f.options,resume:true})).verified,true);
});
test('resume rejects symlinked directories and foreign files',async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options));f.finish();
 const versions=join(f.options.directory,'versions');await rm(versions,{recursive:true});await symlink(join(f.options.directory,'objects'),versions);
 await assert.rejects(pullStore({...f.options,resume:true}),/regular directory/);
 await rm(versions);await writeFile(join(f.options.directory,'unexpected'),'foreign');
 await assert.rejects(pullStore({...f.options,resume:true}),/Unexpected file/);
});
test('resume rejects existing journal corruption without overwriting it',async t=>{
 const f=await fixture(t);await assert.rejects(pullStore(f.options));f.finish();const journal=join(f.options.directory,'journal','00000001.json');await writeFile(journal,'tampered');
 await assert.rejects(pullStore({...f.options,resume:true}),/file differs/);assert.equal(await readFile(journal,'utf8'),'tampered');
});
