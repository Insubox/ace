import {it,expect} from 'vitest';
import {env,SELF} from 'cloudflare:test';
import {type Env,coordinate,sha256} from '../src/contracts';
import {ensure} from '../src/projects';
import {putObject,putVersion,appendEntry,appendRef,nativeHash,readStore,readRefs} from '../src/native-store';
import {createWorkspace,listWorkspaces,workspaceToken,seedWorkspace,submitWorkspace,closeWorkspace} from '../src/artifact-workspaces';
import {capture,copyChunk,restoreChunk,restoreMetadata} from '../src/backups';
import {updateSpending} from '../src/spending-control';
const owner={kind:'operator',username:'operator',role:'admin'} as const;
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const utf8=(s:string)=>new TextEncoder().encode(s);
const seed='1'.repeat(40),left='2'.repeat(40),right='3'.repeat(40),other='4'.repeat(40),tree='5'.repeat(40);
type Provider={description:string;name:string;tokens:{id:string;scope:'write';state:'active'|'revoked';createdAt:string;expiresAt:string}[]};
async function fixture(){
 const project='workspace-'+crypto.randomUUID(),bytes=utf8('initial\n'),object=await sha256(bytes),version={schema_version:1,parents:[],kind:{kind:'source'},message:'baseline',files:{'src/main.txt':object}},base=await nativeHash(version);
 await ensure(env,owner,project);await putObject(env,project,object,bytes);await putVersion(env,project,base,encode({version,content_hash:base}));
 const entry={schema_version:1,sequence:1,previous:null,version:base,content_hash:await nativeHash([1,1,null,base])};await appendEntry(env,project,encode(entry));
 await appendRef(env,project,encode({schema_version:1,sequence:1,previous:null,branch:'main',expected:null,target:base,content_hash:await nativeHash([1,1,null,'main',null,base])}));
 const repos=new Map<string,Provider>(),contents=new Map([[seed,'initial\n'],[left,'left improvement\n'],[right,'right improvement\n'],[other,'unrelated\n']]);
 let createCalls=0,issued=0,disposed=0,entryName='main.txt',mode='100644',type='blob',corrupt=false,large=false;
 const blobs=new Map<string,string>();
 async function blobHash(text:string){const b=utf8(text),h=utf8('blob '+b.length+'\0'),all=new Uint8Array(h.length+b.length);all.set(h);all.set(b,h.length);const id=[...new Uint8Array(await crypto.subtle.digest('SHA-1',all))].map(b=>b.toString(16).padStart(2,'0')).join('');blobs.set(id,text);return id;}
 const binding={
  create:async(name:string,opts:{description:string})=>{createCalls++;if(repos.has(name))throw Object.assign(new Error('already exists'),{code:'ALREADY_EXISTS'});repos.set(name,{name,description:opts.description,tokens:[{id:'initial',scope:'write',state:'active',createdAt:'now',expiresAt:'tomorrow'}]});return{name,token:'initial'};},
  get:async(name:string)=>{
   const p=repos.get(name);if(!p)throw new Error('missing repo');let currentCommit=seed;
   return{
    [Symbol.dispose]:()=>{disposed++;},
    info:async()=>({name,description:p.description,readOnly:false,remote:'https://example.artifacts.test/'+name+'.git'}),
    listTokens:async()=>({tokens:p.tokens,total:p.tokens.length}),
    revokeToken:async(id:string)=>{const t=p.tokens.find(t=>t.id===id);if(t)t.state='revoked';return!!t;},
    createToken:async(scope:'write',ttl:number)=>{issued++;const id='lease-'+issued,expiresAt=new Date(Date.now()+ttl*1000).toISOString();p.tokens.push({id,scope,state:'active',createdAt:'now',expiresAt});return{id,plaintext:'private-'+id,scope,expiresAt};},
    readCommit:async(hash:string)=>{if(!contents.has(hash))return null;currentCommit=hash;return{hash,treeHash:tree,parents:hash===seed||hash===other?[]:[seed]};},
    readTree:async(hash:string)=>hash===tree?[{name:'src',mode:'40000',hash:'6'.repeat(40),type:'tree'}]:[{name:entryName,mode,type,hash:await blobHash(contents.get(currentCommit)!)}],
    readBlob:async(id:string)=>new Blob([large?'x'.repeat(1048577):corrupt?'different':blobs.get(id)!])
   };
  }
 } as unknown as Artifacts;
 const local={...env,SOURCE_WORKSPACES:binding} as Env;
 return{project,base,local,repos,contents,counts:()=>({createCalls,issued,disposed}),attack:(name:string,newMode='100644',newType='blob')=>{entryName=name;mode=newMode;type=newType;},corrupt:()=>{corrupt=true;},large:()=>{large=true;}};
}
const args=(base:string,agent='agent-one')=>({id:crypto.randomUUID(),base,agent,context:'Fix the assigned behavior and preserve the existing tests.'});
it('requires the real Artifacts binding and exposes truthful configuration without creating a workspace',async()=>{
 const f=await fixture();await expect(createWorkspace(env,owner,f.project,encode(args(f.base)))).rejects.toThrow('Artifacts is not configured');
 const result=await(await listWorkspaces(env,owner,f.project)).json() as {configured:boolean;workspaces:unknown[]};expect(result).toMatchObject({configured:false,workspaces:[]});
 const response=await SELF.fetch('https://ace/v1/projects/'+f.project+'/workspaces',{headers:{authorization:'Bearer '+env.API_TOKEN}});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({configured:false});
 const denied=await SELF.fetch('https://ace/v1/projects/'+f.project+'/workspaces',{method:'POST',headers:{authorization:'Bearer '+env.API_TOKEN},body:JSON.stringify(args(f.base))});expect(denied.status).toBe(503);
});
it('serializes repository initialization, revokes provider initial tokens, limits credentials and verifies the native seed',async()=>{
 const f=await fixture(),request=args(f.base);const results=await Promise.allSettled([createWorkspace(f.local,owner,f.project,encode(request)),createWorkspace(f.local,owner,f.project,encode(request))]);expect(results.some(r=>r.status==='fulfilled')).toBe(true);
 await createWorkspace(f.local,owner,f.project,encode(request));expect(f.counts().createCalls).toBe(1);expect([...f.repos.values()][0]!.tokens[0]!.state).toBe('revoked');
 await expect(createWorkspace(f.local,owner,f.project,encode({...request,agent:'different'}))).rejects.toThrow('identity');
 await expect(seedWorkspace(f.local,owner,f.project,request.id,encode({commit:left}))).rejects.toThrow('does not match');await seedWorkspace(f.local,owner,f.project,request.id,encode({commit:seed}));
 for(let i=0;i<8;i++){const response=await workspaceToken(f.local,owner,f.project,request.id);expect(response.headers.get('cache-control')).toBe('no-store');const token=await response.json() as {expires_at:string;scope:string};expect(token.scope).toBe('write');expect(Date.parse(token.expires_at)-Date.now()).toBeLessThanOrEqual(900000);}
 await expect(workspaceToken(f.local,owner,f.project,request.id)).rejects.toThrow('credential limit');expect(f.counts().issued).toBe(8);
 await closeWorkspace(f.local,owner,f.project,request.id);expect([...f.repos.values()][0]!.tokens.every(t=>t.state==='revoked')).toBe(true);await expect(workspaceToken(f.local,owner,f.project,request.id)).rejects.toThrow('closed');
});
it('keeps credentials private to the creator or owner and honors revoked project membership',async()=>{
 const f=await fixture(),request=args(f.base),username='agent-'+crypto.randomUUID().slice(0,8),member={kind:'account',username,role:'writer'} as const;
 await env.DB.prepare("INSERT INTO native_users (username,role,salt,password_hash,created_at) VALUES (?,'writer',?,?,?)").bind(username,'a'.repeat(32),'b'.repeat(64),Date.now()).run();
 await env.DB.prepare("INSERT INTO native_project_members (project,username,role,added_by,created_at) VALUES (?,?,'writer','test',?)").bind(f.project,username,Date.now()).run();
 await createWorkspace(f.local,owner,f.project,encode(request));await expect(workspaceToken(f.local,member,f.project,request.id)).rejects.toThrow('creator or project owner');
 await expect(createWorkspace(f.local,{...member,role:'reader'},f.project,encode(args(f.base)))).rejects.toThrow('permission');
 await env.DB.prepare('DELETE FROM native_project_members WHERE project=? AND username=?').bind(f.project,username).run();await expect(listWorkspaces(f.local,member,f.project)).rejects.toThrow('project not found');expect(f.counts().issued).toBe(0);
});
it('retains two concurrent agent proposals as ACE versions and branches without changing main, and restores context',async()=>{
 const f=await fixture(),a=args(f.base,'agent-one'),b=args(f.base,'agent-two');
 await Promise.all([createWorkspace(f.local,owner,f.project,encode(a)),createWorkspace(f.local,owner,f.project,encode(b))]);
 await Promise.all([seedWorkspace(f.local,owner,f.project,a.id,encode({commit:seed})),seedWorkspace(f.local,owner,f.project,b.id,encode({commit:seed}))]);
 const results=await Promise.all([submitWorkspace(f.local,owner,f.project,a.id,encode({commit:left})),submitWorkspace(f.local,owner,f.project,b.id,encode({commit:right}))]);const receipts=await Promise.all(results.map(r=>r.json())) as {version:string;branch:string}[];
 expect(receipts[0]!.version).not.toBe(receipts[1]!.version);const refs=await(await readRefs(env,f.project)).json() as {heads:Record<string,string>};expect(refs.heads.main).toBe(f.base);for(const r of receipts)expect(refs.heads[r.branch]).toBe(r.version);
 expect(await(await readStore(env,f.project)).json()).toMatchObject({entries:expect.any(Array)});const log=await coordinate(env,'NATIVE-STORE-'+f.project,'native-log') as {entries:unknown[]};expect(log.entries).toHaveLength(3);
 // Heal R2 mirrors after an interrupted publication, rather than treating an
 // authoritative DO entry alone as a complete retained transfer.
 const authority=await coordinate(env,'NATIVE-STORE-'+f.project,'native-log') as {entries:{version:string;sequence:number}[]},retained=authority.entries.find(e=>e.version===receipts[0]!.version)!;
 const references=await(await readRefs(env,f.project)).json() as {events:{branch:string;sequence:number}[]},ref=references.events.find(e=>e.branch===receipts[0]!.branch)!;
 const journalKey=`native-stores/${f.project}/journal/${String(retained.sequence).padStart(8,'0')}.json`,refKey=`native-stores/${f.project}/refs/${String(ref.sequence).padStart(8,'0')}.json`;
 await env.ARTIFACTS.delete([journalKey,refKey]);await submitWorkspace(f.local,owner,f.project,a.id,encode({commit:left}));expect(await env.ARTIFACTS.head(journalKey)).not.toBeNull();expect(await env.ARTIFACTS.head(refKey)).not.toBeNull();expect((await coordinate(env,'NATIVE-STORE-'+f.project,'native-log') as {entries:unknown[]}).entries).toHaveLength(3);
 await expect(submitWorkspace(f.local,owner,f.project,a.id,encode({commit:right}))).rejects.toThrow('already pinned');
 const id='backup-'+crypto.randomUUID(),inventory=await capture(env,id),items=await copyChunk(env,id,inventory.keys);await restoreChunk(env,id,items);await restoreMetadata(env,id,inventory,items);
 const restored=await coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},'RESTORE-'+id+'-NATIVE-'+f.project,'workspace-list') as {workspaces:{context:string;version:string}[]};expect(restored.workspaces).toHaveLength(2);expect(restored.workspaces[0]!.context).toBe(a.context);expect(restored.workspaces.every(w=>!!w.version)).toBe(true);
});
it.each([['../escape','100644','blob'],['.git','40000','symlink'],['link','120000','symlink'],['module','160000','gitlink'],['CON.txt','100644','blob']])('rejects unsafe tree %s before native publication',async(path,mode,type)=>{
 const f=await fixture(),a=args(f.base);await createWorkspace(f.local,owner,f.project,encode(a));await seedWorkspace(f.local,owner,f.project,a.id,encode({commit:seed}));f.attack(path,mode,type);
 await expect(submitWorkspace(f.local,owner,f.project,a.id,encode({commit:left}))).rejects.toThrow();expect((await coordinate(env,'NATIVE-STORE-'+f.project,'native-log') as {entries:unknown[]}).entries).toHaveLength(1);
});
it('rejects detached ancestry, corrupted blobs and excessive bytes without retaining an asserted winner',async()=>{
 const f=await fixture(),a=args(f.base);await createWorkspace(f.local,owner,f.project,encode(a));await seedWorkspace(f.local,owner,f.project,a.id,encode({commit:seed}));
 await expect(submitWorkspace(f.local,owner,f.project,a.id,encode({commit:other}))).rejects.toThrow('does not descend');f.corrupt();await expect(submitWorkspace(f.local,owner,f.project,a.id,encode({commit:left}))).rejects.toThrow('blob hash');f.large();await expect(submitWorkspace(f.local,owner,f.project,a.id,encode({commit:left}))).rejects.toThrow('byte limit');
 expect((await coordinate(env,'NATIVE-STORE-'+f.project,'workspace-get',{id:a.id}) as {commit:null}).commit).toBeNull();
});
it('blocks paid repository creation on stale/missing billing and reserves a conservative allowance for actual creation',async()=>{
 const f=await fixture(),a=args(f.base),protectedEnv={...f.local,SPENDING_CONTROL_MODE:'enforce' as const};
 // This unique DO isolates the account ledger from other tests in this file.
 const {runInDurableObject}=await import('cloudflare:test');await runInDurableObject(env.COORDINATORS.get(env.COORDINATORS.idFromName('ACE-ACCOUNT-SPENDING')),async(_,ctx)=>ctx.storage.deleteAll());
 await expect(createWorkspace(protectedEnv,owner,f.project,encode(a))).rejects.toThrow('billing_snapshot_missing');expect(f.counts().createCalls).toBe(0);
 await updateSpending(protectedEnv,owner,encode({revision:0,period_start:Date.now()-10000,period_end:Date.now()+86400000,observed_at:Date.now(),total_cents:500}));
 await createWorkspace(protectedEnv,owner,f.project,encode(a));const ledger=await coordinate(env,'ACE-ACCOUNT-SPENDING','spending-status') as {reserved_cents:number};expect(ledger.reserved_cents).toBe(100);
 await createWorkspace(protectedEnv,owner,f.project,encode(a));expect((await coordinate(env,'ACE-ACCOUNT-SPENDING','spending-status') as {reserved_cents:number}).reserved_cents).toBe(100);
});
it('accepts a baseline as large as ACE itself and rejects one above the workspace limit before creating provider storage',async()=>{
 const f=await fixture(),object=await sha256(utf8('initial\n'));let tip=(await coordinate(env,'NATIVE-STORE-'+f.project,'native-log') as {tip:string}).tip;
 for(const [index,count]of [415,513].entries()){
  const version={schema_version:1,parents:[f.base],kind:{kind:'source'},message:'repository size '+count,files:Object.fromEntries(Array.from({length:count},(_,i)=>['src/file-'+i+'.txt',object]))},base=await nativeHash(version);
  await putVersion(env,f.project,base,encode({version,content_hash:base}));const entry={schema_version:1,sequence:index+2,previous:tip,version:base,content_hash:await nativeHash([1,index+2,tip,base])};await appendEntry(env,f.project,encode(entry));tip=entry.content_hash;
  if(count===415)await createWorkspace(f.local,owner,f.project,encode(args(base)));else await expect(createWorkspace(f.local,owner,f.project,encode(args(base)))).rejects.toThrow('file limit');
 }
 expect(f.counts().createCalls).toBe(1);
});
