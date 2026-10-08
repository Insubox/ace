// Transport for ACE's native engine. Rust verifies downloaded versions locally.
import { mkdir, writeFile, lstat, realpath,mkdtemp,rm } from 'node:fs/promises';
import { resolve, join, sep,dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {nativeHash,validateRefs} from './native-wire.mjs';
import { api, rawHash, boundedFile } from './client.mjs';
import { responseBytes } from './agent-driver.mjs';
const hash=/^[0-9a-f]{64}$/;
const namePattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const names=n=>{if(!namePattern.test(n))throw new Error('Choose a portable remote ACE store name');return n;};
const command=(binary,args)=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',timeout:180000,maxBuffer:16777216,stdio:['ignore','pipe','pipe']}));
const fetchOptions={signal:()=>AbortSignal.timeout(30000)};
async function publish(request,config,path,init){
  // Consume bounded acknowledgements so long uploads release their connections.
  await responseBytes(await request(config,path,init),16384);
}
async function remote(config,name,request){
  const log=JSON.parse(await responseBytes(await request(config,`/v1/stores/${names(name)}`,{signal:fetchOptions.signal()}),1048576));
  if(log.schema_version!==1||log.backend!=='ace-native-v1'||!Array.isArray(log.entries)||log.entries.length>1024)throw new Error('Unexpected remote native history');
  let previous=null;const seen=new Set();
  for(const [index,e] of log.entries.entries()){
    if(Object.keys(e).sort().join(',')!=='content_hash,previous,schema_version,sequence,version'||e.schema_version!==1||e.sequence!==index+1||e.previous!==previous||!hash.test(e.version)||!hash.test(e.content_hash)||nativeHash([1,e.sequence,e.previous,e.version])!==e.content_hash||seen.has(e.version))throw new Error('Remote native journal identity or order changed');
    previous=e.content_hash;seen.add(e.version);
  }
  if(log.tip!==previous)throw new Error('Remote native history tip differs');return log;
}
async function localFile(root,path,limit){const file=join(root,path);if(!(await lstat(file)).isFile()||!(await realpath(file)).startsWith(root+sep))throw new Error('Native transport source escapes its store');return boundedFile(file,limit);}
async function remoteRefs(config,name,log,request){let value;try{value=JSON.parse(await responseBytes(await request(config,`/v1/stores/${name}/refs`,{signal:fetchOptions.signal()}),4194304));}catch(error){if(error.status===404)return{schema_version:1,events:[],heads:{},tip:null};throw error;}return validateRefs(value,new Set(log.entries.map(e=>e.version)));}
export async function pushStore({directory,name,config,binary='ace',request=api,run=command,refs=true}){
  names(name);const root=await realpath(resolve(directory));const local=run(binary,['store','log',root]);
  if(local.backend!=='ace-native-v1'||local.verified!==true)throw new Error('Only verified native ACE stores can be published');
  if(config.token?.startsWith('ace_session_'))await publish(request,config,'/v1/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name}),signal:fetchOptions.signal()});
  const current=await remote(config,name,request);
  const known=new Set(local.versions.map(v=>v.version));
  if(current.entries.some(e=>!known.has(e.version)))throw new Error('Remote history has versions missing locally; fetch it before merging and pushing');
  const localEntries=[];for(const v of local.versions){const e=JSON.parse(await localFile(root,`journal/${String(v.sequence).padStart(8,'0')}.json`,8192));if(e.version!==v.version||e.content_hash!==v.journal_hash)throw new Error('Native journal changed after local verification');localEntries.push(e);}
  const refsLocal=refs&&Object.hasOwn(local,'refs')?run(binary,['store','refs',root]):null;
  const refsRemote=refsLocal?await remoteRefs(config,name,current,request):null;
  const plannedRefs=[];let refTip=refsRemote?.tip??null,refSequence=refsRemote?.events.length??0;
  if(refsLocal){for(const [branch,head]of Object.entries(refsLocal.heads)){
    const remoteHead=Object.hasOwn(refsRemote.heads,branch)?refsRemote.heads[branch]:null;if(remoteHead===head)continue;
    const history=refsLocal.events.filter(e=>e.branch===branch),index=remoteHead===null?-1:history.findIndex(e=>e.target===remoteHead);
    if(remoteHead!==null&&index===-1)throw new Error('Branch heads diverge; push --versions-only then advance the remote branch with an explicit --expect');
    let expected=remoteHead;for(const original of history.slice(index+1)){if(original.expected!==expected)throw new Error('Local branch ancestry differs from the remote expectation');const event={schema_version:1,sequence:++refSequence,previous:refTip,branch,expected,target:original.target};event.content_hash=nativeHash([1,event.sequence,event.previous,branch,expected,event.target]);plannedRefs.push(event);expected=event.target;refTip=event.content_hash;}
  }}
  const entries=[...current.entries],published=new Set(entries.map(e=>e.version));
  for(const e of localEntries){if(published.has(e.version))continue;const entry={schema_version:1,sequence:entries.length+1,previous:entries.at(-1)?.content_hash??null,version:e.version};entry.content_hash=nativeHash([1,entry.sequence,entry.previous,entry.version]);entries.push(entry);published.add(entry.version);}
  const uploaded=new Set();
  for(const entry of entries){
    const bytes=await localFile(root,`versions/${entry.version}.json`,1048576),sealed=JSON.parse(bytes);
    if(sealed.content_hash!==entry.version)throw new Error('Native version changed after verification');
    for(const id of Object.values(sealed.version.files)){
      if(!hash.test(id))throw new Error('Invalid native object identity');if(uploaded.has(id))continue;
      const object=await localFile(root,`objects/${id}`,8388608);if(rawHash(object)!==id)throw new Error('Native content object changed after verification');
      await publish(request,config,`/v1/stores/${name}/objects/${id}`,{method:'PUT',body:object,signal:fetchOptions.signal()});uploaded.add(id);
    }
    await publish(request,config,`/v1/stores/${name}/versions/${entry.version}`,{method:'PUT',body:bytes,signal:fetchOptions.signal()});
    await publish(request,config,`/v1/stores/${name}/journal`,{method:'POST',body:JSON.stringify(entry),headers:{'content-type':'application/json'},signal:fetchOptions.signal()});
  }
  if(refsLocal)for(const event of plannedRefs)await publish(request,config,`/v1/stores/${name}/refs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event),signal:fetchOptions.signal()});
  const saved=await remote(config,name,request);
  if(saved.entries.length!==entries.length||saved.tip!==(entries.at(-1)?.content_hash??null))throw new Error('Published native history did not retain the expected tip');
  return {store:name,versions:entries.length,objects:uploaded.size,tip:saved.tip,backend:'ace-native-v1',qualification:'verified_locally_before_upload',...(refsLocal?{ref_events:refSequence,ref_tip:refTip}:{}),publication_order_reconciled:saved.tip!==local.tip};
}
export async function pullStore({directory,name,config,binary='ace',request=api,run=command}){
  names(name);const log=await remote(config,name,request),root=resolve(directory);
  await mkdir(root);for(const folder of['objects','versions','journal','views'])await mkdir(join(root,folder));
  await writeFile(join(root,'.ace-store.json'),'{"ace_native_store":1}\n',{flag:'wx'});
  const seen=new Set();let total=0;
  for(const entry of log.entries){
    const bytes=await responseBytes(await request(config,`/v1/stores/${name}/versions/${entry.version}`,{signal:fetchOptions.signal()}),1048576),sealed=JSON.parse(bytes);
    if(sealed.content_hash!==entry.version||!sealed.version?.files||Object.keys(sealed.version.files).length>4096)throw new Error('Downloaded native version differs');
    for(const id of Object.values(sealed.version.files)){
      if(!hash.test(id))throw new Error('Invalid downloaded native object ID');if(seen.has(id))continue;
      const object=await responseBytes(await request(config,`/v1/stores/${name}/objects/${id}`,{signal:fetchOptions.signal()}),8388608);
      if(rawHash(object)!==id)throw new Error('Downloaded native object hash differs');total+=object.length;if(total>536870912)throw new Error('Native pull exceeds the 512 MiB transport limit');
      await writeFile(join(root,'objects',id),object,{flag:'wx'});seen.add(id);
    }
    await writeFile(join(root,'versions',`${entry.version}.json`),bytes,{flag:'wx'});
    await writeFile(join(root,'journal',`${String(entry.sequence).padStart(8,'0')}.json`),JSON.stringify(entry)+'\n',{flag:'wx'});
  }
  const reference=await remoteRefs(config,name,log,request);if(reference.events.length){await mkdir(join(root,'refs'));for(const event of reference.events)await writeFile(join(root,'refs',`${String(event.sequence).padStart(8,'0')}.json`),JSON.stringify(event)+'\n',{flag:'wx'});}
  const verified=run(binary,['store','log',root]);
  if(verified.backend!=='ace-native-v1'||verified.verified!==true||verified.tip!==log.tip)throw new Error('Downloaded native history did not pass local ACE verification');
  return {store:name,directory:root,versions:log.entries.length,objects:seen.size,tip:verified.tip,verified:true,bytes:total};
}

export async function fetchStore({directory,name,config,binary='ace',request=api,run=command}){
 const root=resolve(directory),temporary=await mkdtemp(join(dirname(root),'.ace-fetch-'));
 try{const incoming=join(temporary,'incoming');await pullStore({directory:incoming,name,config,binary,request,run});return run(binary,['store','fetch',incoming,root]);}finally{await rm(temporary,{recursive:true,force:true});}
}
export async function advanceRef({name,branch,target,expected=null,config,request=api}){
 names(name);names(branch);if(!hash.test(target)||expected!==null&&!hash.test(expected))throw new Error('Branch target/expectation must be native version hashes');
 const log=await remote(config,name,request),refs=await remoteRefs(config,name,log,request);if(!log.entries.some(e=>e.version===target))throw new Error('Publish the branch target first');if((Object.hasOwn(refs.heads,branch)?refs.heads[branch]:null)!==expected)throw new Error('Remote branch changed; fetch its current head before retrying');
 const event={schema_version:1,sequence:refs.events.length+1,previous:refs.tip,branch,expected,target};event.content_hash=nativeHash([1,event.sequence,event.previous,branch,expected,target]);await publish(request,config,`/v1/stores/${name}/refs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event),signal:fetchOptions.signal()});return{branch,head:target,expected,reference:event.content_hash};
}
