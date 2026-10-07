// Native ACE hosting: immutable objects and versions, serialized journal publication.
// Uploaded evaluation labels remain caller asserted; hosting never qualifies code.
import { z } from 'zod';
import { type Env, hash, strictJson, sha256, immutablePut, coordinate, HttpError, json } from './contracts';

const encoder=new TextEncoder();
export const storeName=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const kind=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('source')}),
  z.strictObject({kind:z.literal('evaluation'),report_hash:hash}),
  z.strictObject({kind:z.literal('generator_fault'),context_hash:hash}),
]);
const filename=z.string().min(1).max(2048).refine(name=>encoder.encode(name).length<=2048&&name.split('/').every(part=>part.length>0&&part!=='.'&&part!=='..'
  &&encoder.encode(part).length<=255&&!/[\\:<>"|?*\x00-\x1f\x7f]/.test(part)&&!/[. ]$/.test(part)
  &&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)));
export const versionSchema=z.strictObject({version:z.strictObject({schema_version:z.literal(1),parents:z.array(hash).max(2),
  kind,message:z.string().refine(s=>s.trim().length>0&&encoder.encode(s).length<=4096),files:z.record(filename,hash)}),content_hash:hash}).superRefine((sealed,ctx)=>{
  const parents=sealed.version.parents,names=Object.keys(sealed.version.files),folded=new Set(names.map(n=>n.toLowerCase()));
  if(names.length<1||names.length>4096||folded.size!==names.length||new Set(parents).size!==parents.length||[...parents].sort().some((p,i)=>p!==parents[i]))ctx.addIssue({code:'custom',message:'invalid native file tree or parents'});
  for(const name of names){const parts=name.toLowerCase().split('/');parts.pop();while(parts.length){if(folded.has(parts.join('/')))ctx.addIssue({code:'custom',message:'file/directory collision'});parts.pop();}}
});
export const entrySchema=z.strictObject({schema_version:z.literal(1),sequence:z.number().int().min(1).max(256),
  previous:hash.nullable(),version:hash,content_hash:hash});
export type NativeEntry=z.infer<typeof entrySchema>;

// Rust BTreeMap orders Unicode scalar values through UTF-8. Use that order,
// rather than JS's default UTF-16 ordering, for arbitrary source path keys.
const compare=(a:string,b:string)=>{const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(aa.length,bb.length);i++){if(aa[i]!==bb[i])return aa[i]!-bb[i]!;}return aa.length-bb.length;};
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object'){const object=value as Record<string,unknown>;return '{'+Object.keys(object).sort(compare).map(k=>JSON.stringify(k)+':'+canonical(object[k])).join(',')+'}';}
  return JSON.stringify(value);
}
export async function nativeHash(value:unknown){return sha256(encoder.encode('ace:canonical-json:v1\0'+canonical(value)));}
const prefix=(name:string)=>`native-stores/${storeName.parse(name)}/`;
const decode=(bytes:Uint8Array)=>strictJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
export async function loadVersion(env:Env,name:string,id:string){const object=await env.ARTIFACTS.get(prefix(name)+`versions/${hash.parse(id)}.json`);if(!object)throw new HttpError(404,'native version not found');const sealed=versionSchema.parse(strictJson(await object.text()));if(sealed.content_hash!==id||await nativeHash(sealed.version)!==id)throw new HttpError(503,'native version corrupted');return sealed;}
export async function putObject(env:Env,name:string,id:string,bytes:Uint8Array){hash.parse(id);if(bytes.length>8388608)throw new HttpError(413,'native object exceeds 8 MiB');if(await sha256(bytes)!==id)throw new HttpError(409,'native object hash differs');await immutablePut(env.ARTIFACTS,prefix(name)+`objects/${id}`,bytes);return json({object:id,retained:true});}
export async function putVersion(env:Env,name:string,id:string,bytes:Uint8Array){
  const sealed=versionSchema.parse(decode(bytes));if(sealed.content_hash!==hash.parse(id)||await nativeHash(sealed.version)!==id)throw new HttpError(409,'native version hash differs');
  let total=0;for(const objectHash of Object.values(sealed.version.files)){const object=await env.ARTIFACTS.head(prefix(name)+`objects/${objectHash}`);if(!object)throw new HttpError(409,'upload native objects before the version');total+=object.size;if(total>134217728)throw new HttpError(413,'native file tree exceeds 128 MiB');}
  // Normalize envelope formatting, preserving its canonical version identity.
  await immutablePut(env.ARTIFACTS,prefix(name)+`versions/${id}.json`,encoder.encode(JSON.stringify(sealed)));
  return json({version:id,retained:true,qualification:'caller_asserted_requires_ACE_verification'});
}
export async function appendEntry(env:Env,name:string,bytes:Uint8Array,publisher='internal'){
  const entry=entrySchema.parse(decode(bytes));if(await nativeHash([entry.schema_version,entry.sequence,entry.previous,entry.version])!==entry.content_hash)throw new HttpError(409,'native journal hash differs');
  const sealed=await loadVersion(env,name,entry.version);
  const result=await coordinate(env,`NATIVE-STORE-${storeName.parse(name)}`,'native-append',{entry,parents:sealed.version.parents,publisher});
  await immutablePut(env.ARTIFACTS,prefix(name)+`journal/${String(entry.sequence).padStart(8,'0')}.json`,encoder.encode(JSON.stringify(entry)));
  await env.DB.prepare('INSERT INTO native_stores (name, version_count, tip, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET version_count = max(version_count, excluded.version_count), tip = CASE WHEN excluded.version_count >= version_count THEN excluded.tip ELSE tip END, updated_at = max(updated_at, excluded.updated_at)')
    .bind(name,entry.sequence,entry.content_hash,Date.now()).run();
  return json(result);
}
export async function readStore(env:Env,name:string){return json(await coordinate(env,`NATIVE-STORE-${storeName.parse(name)}`,'native-log',{}));}
export async function listStores(env:Env){const result=await env.DB.prepare('SELECT name, version_count, tip, updated_at FROM native_stores ORDER BY updated_at DESC LIMIT 100').all();return json({stores:result.results,scope:'private_shared_workspace',account_roles:['admin','writer','reader']});}
export async function readFile(env:Env,name:string,kind:'objects'|'versions',id:string){
  if(kind==='versions')return json(await loadVersion(env,name,id));
  const object=await env.ARTIFACTS.get(prefix(name)+`objects/${hash.parse(id)}`);if(!object)throw new HttpError(404,'native object not found');const bytes=new Uint8Array(await object.arrayBuffer());if(await sha256(bytes)!==id)throw new HttpError(503,'native object corrupted');return new Response(bytes,{headers:{'content-type':'application/octet-stream'}});
}

export const refSchema=z.strictObject({schema_version:z.literal(1),sequence:z.number().int().min(1).max(1024),previous:hash.nullable(),branch:storeName,expected:hash.nullable(),target:hash,content_hash:hash});
export type NativeRef=z.infer<typeof refSchema>;
export async function readRefs(env:Env,name:string){return json(await coordinate(env,'NATIVE-STORE-'+storeName.parse(name),'native-refs'));}
export async function appendRef(env:Env,name:string,input:Uint8Array){
 const ref=refSchema.parse(decode(input));if(await nativeHash([ref.schema_version,ref.sequence,ref.previous,ref.branch,ref.expected,ref.target])!==ref.content_hash)throw new HttpError(409,'native reference hash differs');
 const log=await coordinate(env,'NATIVE-STORE-'+storeName.parse(name),'native-log') as {entries:NativeEntry[]};const published=new Set(log.entries.map(e=>e.version));if(!published.has(ref.target))throw new HttpError(409,'publish the branch target first');
 if(ref.expected){const seen=new Set<string>(),next=[ref.target];while(next.length){const id=next.pop()!;if(seen.has(id))continue;if(!published.has(id))throw new HttpError(409,'branch ancestry is unpublished');seen.add(id);const version=await loadVersion(env,name,id);next.push(...version.version.parents);}if(!seen.has(ref.expected))throw new HttpError(409,'branch update is not a fast-forward');}
 const result=await coordinate(env,'NATIVE-STORE-'+name,'native-ref-append',{ref});await immutablePut(env.ARTIFACTS,prefix(name)+`refs/${String(ref.sequence).padStart(8,'0')}.json`,encoder.encode(JSON.stringify(ref)));return json(result);
}
