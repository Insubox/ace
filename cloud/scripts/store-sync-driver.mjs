// Transport for ACE's native engine. Rust verifies downloaded versions locally.
import { mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  const log=JSON.parse(await responseBytes(await request(config,`/v1/stores/${names(name)}`,{signal:fetchOptions.signal()}),262144));
  if(log.schema_version!==1||log.backend!=='ace-native-v1'||!Array.isArray(log.entries)||log.entries.length>256)throw new Error('Unexpected remote native history');
  let previous=null;const seen=new Set();
  for(const [index,e] of log.entries.entries()){
    if(Object.keys(e).sort().join(',')!=='content_hash,previous,schema_version,sequence,version'||e.schema_version!==1||e.sequence!==index+1||e.previous!==previous||!hash.test(e.version)||!hash.test(e.content_hash)||seen.has(e.version))throw new Error('Remote native journal identity or order changed');
    previous=e.content_hash;seen.add(e.version);
  }
  if(log.tip!==previous)throw new Error('Remote native history tip differs');return log;
}
async function localFile(root,path,limit){const file=join(root,path);if(!(await lstat(file)).isFile()||!(await realpath(file)).startsWith(root+sep))throw new Error('Native transport source escapes its store');return boundedFile(file,limit);}
export async function pushStore({directory,name,config,binary='ace',request=api,run=command}){
  names(name);const root=await realpath(resolve(directory));const local=run(binary,['store','log',root]);
  if(local.backend!=='ace-native-v1'||local.verified!==true)throw new Error('Only verified native ACE stores can be published');
  const current=await remote(config,name,request);
  if(current.entries.length>local.versions.length)throw new Error('Remote history has newer versions; pull it into a fresh store');
  const entries=[];for(const v of local.versions){const e=JSON.parse(await localFile(root,`journal/${String(v.sequence).padStart(8,'0')}.json`,8192));if(e.version!==v.version||e.content_hash!==v.journal_hash)throw new Error('Native journal changed after local verification');entries.push(e);}
  if(current.entries.some((e,i)=>e.content_hash!==entries[i].content_hash))throw new Error('Remote history diverges; choose a fresh remote name');
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
  const saved=await remote(config,name,request);
  if(saved.entries.length!==entries.length||saved.tip!==local.tip)throw new Error('Published native history did not retain the expected tip');
  return {store:name,versions:entries.length,objects:uploaded.size,tip:saved.tip,backend:'ace-native-v1',qualification:'verified_locally_before_upload'};
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
  const verified=run(binary,['store','log',root]);
  if(verified.backend!=='ace-native-v1'||verified.verified!==true||verified.tip!==log.tip)throw new Error('Downloaded native history did not pass local ACE verification');
  return {store:name,directory:root,versions:log.entries.length,objects:seen.size,tip:verified.tip,verified:true,bytes:total};
}
