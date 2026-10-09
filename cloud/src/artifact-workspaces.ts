// Artifacts is a bounded staging area. ACE's own objects/journal/refs remain authoritative.
import {z} from 'zod';
import {type Env,HttpError,coordinate,json,strictJson,sha256} from './contracts';
import type {Identity} from './accounts';
import * as projects from './projects';
import {filename,loadVersion,nativeHash,versionSchema,putObject,putVersion,appendEntry,appendRef,readRefs,type NativeEntry,type NativeRef} from './native-store';
import {workspaceRequest,workspaceId,gitHash,type Workspace,WORKSPACE_LIMIT} from './artifact-workspace-state';
import {requireSpendingAdmission,reservePaidStart} from './spending-control';

const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const subject=(actor:Identity)=>actor.kind+':'+actor.username;
const state=(env:Env,project:string,op:string,data:unknown={})=>coordinate(env,'NATIVE-STORE-'+project,'workspace-'+op,data);
const sourcePath=filename.refine(p=>!p.split('/').some(c=>/^\.(git|ace)$/i.test(c)));
export const workspaceLimits={workspaces_per_project:WORKSPACE_LIMIT,files:512,tree_entries:1024,depth:16,file_bytes:1048576,total_bytes:8388608,ancestry_commits:64,token_ttl_seconds:900,tokens_per_workspace:8};
function binding(env:Env){if(!env.SOURCE_WORKSPACES)throw new HttpError(503,'Cloudflare Artifacts is not configured');return env.SOURCE_WORKSPACES;}
async function owned(env:Env,actor:Identity,project:string,id:string){
 const role=await projects.access(env,actor,project,'write'),w=await state(env,project,'get',{id:workspaceId.parse(id)}) as Workspace;
 if(w.creator!==subject(actor)&&role!=='owner')throw new HttpError(403,'workspace creator or project owner required');return w;
}
function active(w:Workspace){if(w.closed||Date.now()>=w.expires_at)throw new HttpError(409,'workspace closed or expired');}
const description=(w:Workspace)=>'ACE workspace '+w.request_hash;
async function repoFor(env:Env,w:Workspace){
 const repo=await binding(env).get(w.repo);
 try{const info=await repo.info();if(info.name!==w.repo||info.description!==description(w)||info.readOnly)throw new HttpError(409,'Artifacts repository ownership differs');return repo;}
 catch(e){repo[Symbol.dispose]();throw e;}
}
async function revokeAll(repo:ArtifactsRepo){
 const list=await repo.listTokens();if(list.total>32)throw new HttpError(503,'Artifacts credential inventory exceeds bounds');
 for(const token of list.tokens)if(token.state==='active')await repo.revokeToken(token.id);
}
async function ensureRepo(env:Env,w:Workspace){
 try{
  await reservePaidStart(env,'artifacts');
  const created=await binding(env).create(w.repo,{description:description(w),setDefaultBranch:'main'});
  // The initial provider token is never returned or retained. Issue short-lived credentials separately.
  using repo=await repoFor(env,w);await repo.revokeToken(created.token);
 }catch(e){if((e as {code?:string}).code!=='ALREADY_EXISTS')throw e;using repo=await repoFor(env,w);await revokeAll(repo);}
}
export async function listWorkspaces(env:Env,actor:Identity,project:string){
 await projects.access(env,actor,project);const result=await state(env,project,'list');
 return json({configured:!!env.SOURCE_WORKSPACES,backend:'cloudflare-artifacts',limits:workspaceLimits,...result as object});
}
export async function createWorkspace(env:Env,actor:Identity,project:string,input:Uint8Array){
 await projects.access(env,actor,project,'write');binding(env);
 const args=workspaceRequest.parse(strictJson(new TextDecoder().decode(input))),base=await loadVersion(env,project,args.base);
 if(Object.keys(base.version.files).length>workspaceLimits.files)throw new HttpError(413,'workspace baseline exceeds file limit');
 let size=0;for(const [path,id]of Object.entries(base.version.files)){
  sourcePath.parse(path);const meta=await env.ARTIFACTS.head(`native-stores/${project}/objects/${id}`);
  if(!meta)throw new HttpError(503,'workspace baseline source missing');size+=meta.size;
  if(meta.size>workspaceLimits.file_bytes||size>workspaceLimits.total_bytes)throw new HttpError(413,'workspace baseline exceeds byte limit');
 }
 const request_hash=await nativeHash([project,subject(actor),args]),now=Date.now();
 let w=await state(env,project,'create',{workspace:{...args,creator:subject(actor),request_hash,repo:'ace-'+request_hash.slice(0,48),branch:'agent-'+args.id,created_at:now,expires_at:now+48*3600000,ready:false,initialization_token:null,initializing_until:0,seed:null,commit:null,version:null,tokens_used:0,closed:false}}) as Workspace;
 active(w);if(!w.ready){
  await requireSpendingAdmission(env,'artifacts');const token=crypto.randomUUID();w=await state(env,project,'initialize',{id:w.id,token}) as Workspace;
  if(!w.ready){try{await ensureRepo(env,w);w=await state(env,project,'ready',{id:w.id,token}) as Workspace;}catch(e){await state(env,project,'release',{id:w.id,token});throw e;}}
 }
 await projects.audit(env,actor,project,'workspace.create',w.id,'workspace-create-'+w.id);return json(w,201);
}
export async function workspaceToken(env:Env,actor:Identity,project:string,id:string){
 const w=await owned(env,actor,project,id);active(w);await requireSpendingAdmission(env,'artifacts');
 await state(env,project,'token',{id});using repo=await repoFor(env,w);const info=await repo.info(),remote=new URL(info.remote);
 if(remote.protocol!=='https:'||remote.username||remote.password)throw new HttpError(503,'Artifacts returned an unsafe remote');
 const ttl=Math.min(workspaceLimits.token_ttl_seconds,Math.floor((w.expires_at-Date.now())/1000));if(ttl<60)throw new HttpError(409,'workspace is expiring');
 const token=await repo.createToken('write',ttl);
 return Response.json({remote:remote.href,token:token.plaintext,expires_at:token.expiresAt,scope:'write',workspace:id},{headers:{'cache-control':'no-store','pragma':'no-cache','referrer-policy':'no-referrer'}});
}
type Snapshot={files:Record<string,string>;objects:Map<string,Uint8Array>};
async function snapshot(repo:ArtifactsRepo,commit:string):Promise<Snapshot>{
 const root=await repo.readCommit(gitHash.parse(commit));if(!root||root.hash!==commit)throw new HttpError(404,'Artifacts commit not found');
 const files:Record<string,string>=Object.create(null),objects=new Map<string,Uint8Array>(),pending=[{hash:gitHash.parse(root.treeHash),prefix:'',depth:0}];let entries=0,total=0;
 while(pending.length){const current=pending.pop()!;if(current.depth>workspaceLimits.depth)throw new HttpError(413,'Artifacts tree depth exceeds limit');
  const tree=await repo.readTree(current.hash);if(!tree)throw new HttpError(503,'Artifacts tree missing');entries+=tree.length;
  if(entries>workspaceLimits.tree_entries)throw new HttpError(413,'Artifacts tree exceeds entry limit');
  const names=new Set<string>();for(const entry of tree){
   if(entry.name.includes('/')||names.has(entry.name)||!entry.name)throw new HttpError(400,'invalid Artifacts tree entry');names.add(entry.name);
   const path=sourcePath.parse(current.prefix+entry.name);gitHash.parse(entry.hash);
   if(entry.type==='tree'&&entry.mode==='40000'){pending.push({hash:entry.hash,prefix:path+'/',depth:current.depth+1});continue;}
   if(!((entry.type==='blob'&&entry.mode==='100644')||(entry.type==='exec'&&entry.mode==='100755')))throw new HttpError(400,'symlinks and submodules are not supported');
   if(Object.hasOwn(files,path)||Object.keys(files).length>=workspaceLimits.files)throw new HttpError(413,'Artifacts file count exceeds limit');
   const blob=await repo.readBlob(entry.hash);if(!blob)throw new HttpError(503,'Artifacts blob missing');
   if(blob.size>workspaceLimits.file_bytes||total+blob.size>workspaceLimits.total_bytes)throw new HttpError(413,'Artifacts source exceeds byte limit');
   const bytes=new Uint8Array(await blob.arrayBuffer()),header=new TextEncoder().encode('blob '+bytes.length+'\0'),gitBytes=new Uint8Array(header.length+bytes.length);gitBytes.set(header);gitBytes.set(bytes,header.length);
   const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-1',gitBytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(actual!==entry.hash)throw new HttpError(503,'Artifacts blob hash differs');
   total+=bytes.length;const id=await sha256(bytes);files[path]=id;objects.set(id,bytes);
  }
 }
 return{files,objects};
}
export async function seedWorkspace(env:Env,actor:Identity,project:string,id:string,input:Uint8Array){
 const w=await owned(env,actor,project,id);active(w);const {commit}=z.strictObject({commit:gitHash}).parse(strictJson(new TextDecoder().decode(input)));
 using repo=await repoFor(env,w);const base=await loadVersion(env,project,w.base),tree=await snapshot(repo,commit);
 if(await nativeHash(tree.files)!==await nativeHash(base.version.files))throw new HttpError(409,'Artifacts seed does not match the ACE baseline');
 const result=await state(env,project,'seed',{id,commit});await projects.audit(env,actor,project,'workspace.seed',id,'workspace-seed-'+id);return json(result);
}
async function ancestor(repo:ArtifactsRepo,commit:string,seed:string){
 const pending=[commit],seen=new Set<string>();while(pending.length){const id=pending.pop()!;if(id===seed)return;if(seen.has(id))continue;
  if(seen.size>=workspaceLimits.ancestry_commits)throw new HttpError(413,'Artifacts ancestry exceeds limit');seen.add(id);
  const node=await repo.readCommit(id);if(!node||node.hash!==id||node.parents.length>2)throw new HttpError(409,'Artifacts ancestry missing or unsupported');for(const parent of node.parents)pending.push(gitHash.parse(parent));
 }throw new HttpError(409,'Artifacts proposal does not descend from its pinned seed');
}
async function publish(env:Env,project:string,w:Workspace,version:string){
 for(let attempt=0;attempt<8;attempt++){
  const log=await coordinate(env,'NATIVE-STORE-'+project,'native-log') as {entries:NativeEntry[];tip:string|null},existing=log.entries.find(e=>e.version===version);
  if(existing){await appendEntry(env,project,encode(existing),w.creator);return;}
  const entry={schema_version:1,sequence:log.entries.length+1,previous:log.tip,version,content_hash:await nativeHash([1,log.entries.length+1,log.tip,version])};
  try{await appendEntry(env,project,encode(entry),w.creator);return;}catch(e){if(!(e instanceof HttpError)||e.status!==409)throw e;}
 }throw new HttpError(409,'native journal is busy; retry the same proposal');
}
async function branch(env:Env,project:string,w:Workspace,version:string){
 for(let attempt=0;attempt<8;attempt++){
  const refs=await(await readRefs(env,project)).json() as {events:NativeRef[];heads:Record<string,string>;tip:string|null};
  if(refs.heads[w.branch]===version){const existing=refs.events.find(e=>e.branch===w.branch&&e.target===version);if(!existing)throw new HttpError(503,'workspace reference mirror is incomplete');await appendRef(env,project,encode(existing));return;}
  if(Object.hasOwn(refs.heads,w.branch))throw new HttpError(409,'workspace branch already has another version');
  const ref={schema_version:1,sequence:refs.events.length+1,previous:refs.tip,branch:w.branch,expected:null,target:version,content_hash:await nativeHash([1,refs.events.length+1,refs.tip,w.branch,null,version])};
  try{await appendRef(env,project,encode(ref));return;}catch(e){if(!(e instanceof HttpError)||e.status!==409)throw e;}
 }throw new HttpError(409,'native refs are busy; retry the same proposal');
}
export async function submitWorkspace(env:Env,actor:Identity,project:string,id:string,input:Uint8Array){
 const w=await owned(env,actor,project,id);active(w);const {commit}=z.strictObject({commit:gitHash}).parse(strictJson(new TextDecoder().decode(input)));
 if(!w.seed)throw new HttpError(409,'verify the workspace seed first');
 using repo=await repoFor(env,w);await ancestor(repo,commit,w.seed);const tree=await snapshot(repo,commit),base=await loadVersion(env,project,w.base);
 if(await nativeHash(tree.files)===await nativeHash(base.version.files))throw new HttpError(409,'Artifacts proposal has no source changes');
 const version={schema_version:1 as const,parents:[w.base],kind:{kind:'source' as const},message:`Artifacts workspace ${w.id} · agent ${w.agent} · commit ${commit}`,files:tree.files},versionId=await nativeHash(version),sealed={version,content_hash:versionId};versionSchema.parse(sealed);
 await state(env,project,'pin',{id,commit});
 // Validate the entire tree before retaining anything. Never move the project main branch.
 for(const [hash,bytes]of tree.objects)await putObject(env,project,hash,bytes);
 await putVersion(env,project,versionId,encode(sealed));await publish(env,project,w,versionId);await branch(env,project,w,versionId);
 await state(env,project,'retain',{id,commit,version:versionId});await revokeAll(repo);
 await projects.audit(env,actor,project,'workspace.proposal',versionId,'workspace-proposal-'+id);
 return json({workspace:id,version:versionId,branch:w.branch,git_commit:commit,qualification:'source_only_requires_independent_review_and_evaluation',main_unchanged:true});
}
export async function closeWorkspace(env:Env,actor:Identity,project:string,id:string){
 const w=await owned(env,actor,project,id);using repo=await repoFor(env,w);await revokeAll(repo);const result=await state(env,project,'close',{id});
 await projects.audit(env,actor,project,'workspace.close',id,'workspace-close-'+id);return json(result);
}
