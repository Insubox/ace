import { env, SELF } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import migration from '../migrations/0003_native_stores.sql?raw';
import { type Env, sha256, coordinate } from '../src/contracts';
import { nativeHash, putObject, putVersion, appendEntry, readFile, readStore, type NativeEntry, versionSchema,appendRef,readRefs,type NativeRef } from '../src/native-store';
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
beforeAll(async()=>{await env.DB.batch(migration.split(';').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));});
async function fixture(parents:string[]=[],message='source snapshot'){
  const bytes=new TextEncoder().encode('code\r\n'),object=await sha256(bytes);
  const version={schema_version:1,parents,kind:{kind:'source'},message,files:{'src/main.txt':object}};
  const id=await nativeHash(version);return {bytes,object,version,id,sealed:{version,content_hash:id}};
}
async function entry(version:string,sequence=1,previous:string|null=null):Promise<NativeEntry>{return{schema_version:1,sequence,previous,version,content_hash:await nativeHash([1,sequence,previous,version])};}
const name=()=>`test-${crypto.randomUUID()}`;
it('serves a static login view without exposing protected native history or credentials',async()=>{
  const page=await SELF.fetch('https://ace/');expect(page.status).toBe(200);expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
  const html=await page.text();expect(html).toContain('Native versions');expect(html).not.toContain('local-tests-only-0123456789abcdef0123456789abcdef');
  expect((await SELF.fetch('https://ace/v1/stores')).status).toBe(401);
});
it('native hosting requires authentication and refuses incorrect objects, unknown fields and path escape',async()=>{
  expect((await SELF.fetch('https://ace/v1/stores')).status).toBe(401);
  const f=await fixture(),n=name();await expect(putObject(env,n,f.object,new Uint8Array([1]))).rejects.toThrow('hash differs');
  expect(()=>versionSchema.parse({...f.sealed,version:{...f.version,files:{'../escape':f.object}}})).toThrow();
  expect(()=>versionSchema.parse({...f.sealed,version:{...f.version,files:{'A.txt':f.object,'a.txt':f.object}}})).toThrow();
  expect(()=>versionSchema.parse({...f.sealed,version:{...f.version,auto_qualify:true}})).toThrow();
});
it('stores exact objects and immutable native versions before publishing a journal',async()=>{
  const f=await fixture(),n=name(),e=await entry(f.id);
  await expect(putVersion(env,n,f.id,encode(f.sealed))).rejects.toThrow('upload native objects');
  await putObject(env,n,f.object,f.bytes);await putVersion(env,n,f.id,encode(f.sealed));
  await appendEntry(env,n,encode(e));expect(await(await readStore(env,n)).json()).toMatchObject({entries:[e],tip:e.content_hash});
  expect(new Uint8Array(await(await readFile(env,n,'objects',f.object)).arrayBuffer())).toEqual(f.bytes);
  expect(await(await readFile(env,n,'versions',f.id)).json()).toEqual(f.sealed);
  await appendEntry(env,n,encode(e));expect((await coordinate(env,`NATIVE-STORE-${n}`,'native-log',{}) as {entries:unknown[]}).entries).toHaveLength(1);
});
it('serializes concurrent publication and rejects divergent histories and unknown parents',async()=>{
  const n=name(),a=await fixture([], 'first'),b=await fixture([], 'conflicting');
  await putObject(env,n,a.object,a.bytes);for(const f of[a,b])await putVersion(env,n,f.id,encode(f.sealed));
  const results=await Promise.allSettled([appendEntry(env,n,encode(await entry(a.id))),appendEntry(env,n,encode(await entry(b.id)))]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  const log=await(await readStore(env,n)).json() as {entries:NativeEntry[]};const c=await fixture(['0'.repeat(64)],'bad parent');await putVersion(env,n,c.id,encode(c.sealed));
  await expect(appendEntry(env,n,encode(await entry(c.id,2,log.entries[0]!.content_hash)))).rejects.toThrow('ancestry');
});
it('repairs interrupted R2/index publication without appending another native version',async()=>{
  const n=name(),f=await fixture(),e=await entry(f.id);await putObject(env,n,f.object,f.bytes);await putVersion(env,n,f.id,encode(f.sealed));
  const artifacts=new Proxy(env.ARTIFACTS,{get(target,p){if(p==='put')return async(key:string)=>{if(key.includes('/journal/'))throw new Error('transient journal publication');throw new Error('unexpected write');};const v=Reflect.get(target,p);return typeof v==='function'?v.bind(target):v;}});
  await expect(appendEntry({...env,ARTIFACTS:artifacts} as Env,n,encode(e))).rejects.toThrow('transient journal');
  await appendEntry(env,n,encode(e));const log=await(await readStore(env,n)).json() as {entries:unknown[]};expect(log.entries).toHaveLength(1);
  expect(await env.DB.prepare('SELECT version_count, tip FROM native_stores WHERE name = ?').bind(n).first()).toMatchObject({version_count:1,tip:e.content_hash});
});
it('detects corrupted downloaded objects and hashes Unicode keys in Rust scalar order',async()=>{
  const n=name(),f=await fixture();await putObject(env,n,f.object,f.bytes);await env.ARTIFACTS.put(`native-stores/${n}/objects/${f.object}`,new Uint8Array([1]));await expect(readFile(env,n,'objects',f.object)).rejects.toThrow('corrupted');
  const a={'\u{10000}':1,'\ue000':2},b={'\ue000':2,'\u{10000}':1};expect(await nativeHash(a)).toBe(await nativeHash(b));
  expect(await nativeHash(a)).toBe(await sha256(new TextEncoder().encode('ace:canonical-json:v1\0{"\ue000":2,"\u{10000}":1}')));
});

async function reference(target:string,sequence=1,previous:string|null=null,expected:string|null=null):Promise<NativeRef>{return{schema_version:1,sequence,previous,branch:'main',expected,target,content_hash:await nativeHash([1,sequence,previous,'main',expected,target])};}
it('serializes branch compare-and-swap and rejects rewinds without changing either native version',async()=>{
 const n=name(),root=await fixture(),left=await fixture([root.id],'left'),right=await fixture([root.id],'right');await putObject(env,n,root.object,root.bytes);let tip:string|null=null;
 for(const [i,f]of[root,left,right].entries()){await putVersion(env,n,f.id,encode(f.sealed));const e=await entry(f.id,i+1,tip);await appendEntry(env,n,encode(e));tip=e.content_hash;}
 const initial=await reference(root.id);await appendRef(env,n,encode(initial));await appendRef(env,n,encode(initial));
 const a=await reference(left.id,2,initial.content_hash,root.id),b=await reference(right.id,2,initial.content_hash,root.id);const replies=await Promise.allSettled([appendRef(env,n,encode(a)),appendRef(env,n,encode(b))]);expect(replies.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const current=await(await readRefs(env,n)).json() as {heads:Record<string,string>;events:NativeRef[]};expect(current.events).toHaveLength(2);
 const head=current.heads.main!,event=current.events[1]!;await expect(appendRef(env,n,encode(await reference(root.id,3,event.content_hash,head)))).rejects.toThrow('fast-forward');
 expect((await(await readRefs(env,n)).json() as {heads:Record<string,string>}).heads.main).toBe(head);
});
it('branch publication requires a published target and rejects a modified reference seal',async()=>{
 const n=name(),f=await fixture();await putObject(env,n,f.object,f.bytes);await putVersion(env,n,f.id,encode(f.sealed));const ref=await reference(f.id);
 await expect(appendRef(env,n,encode(ref))).rejects.toThrow('target first');
 await appendEntry(env,n,encode(await entry(f.id)));await expect(appendRef(env,n,encode({...ref,content_hash:'0'.repeat(64)}))).rejects.toThrow('hash differs');
});
it('checks a complete repository with bounded parallel metadata and counts shared file bytes',async()=>{
 const base=await fixture(),files=Object.fromEntries(Array.from({length:377},(_,i)=>[`src/file-${i}.txt`,i.toString(16).padStart(64,'0')]));
 let active=0,peak=0,calls=0,published=0;const bucket={head:async()=>{active++;calls++;peak=Math.max(peak,active);await Promise.resolve();active--;return{size:1};},put:async()=>{published++;return{};}};
 const local={...env,ARTIFACTS:bucket} as unknown as Env,version={...base.version,files},id=await nativeHash(version);
 await putVersion(local,'large-source',id,encode({version,content_hash:id}));expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(8);expect(calls).toBe(377);expect(published).toBe(1);
 const shared={...base.version,files:Object.fromEntries(Array.from({length:17},(_,i)=>[`src/shared-${i}.txt`,base.object]))},sharedId=await nativeHash(shared);calls=0;published=0;
 bucket.head=async()=>{calls++;return{size:8388608};};await expect(putVersion(local,'shared-too-large',sharedId,encode({version:shared,content_hash:sharedId}))).rejects.toThrow('128 MiB');expect(calls).toBe(1);expect(published).toBe(0);
 bucket.head=async()=>null as unknown as {size:number};await expect(putVersion(local,'missing',id,encode({version,content_hash:id}))).rejects.toThrow('upload native objects');
});
