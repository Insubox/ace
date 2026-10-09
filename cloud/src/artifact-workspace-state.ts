import {z} from 'zod';
import {readState,writeState} from './paged-state';
import {HttpError,hash} from './contracts';
import {storeName} from './native-store';

export const gitHash=z.string().regex(/^[0-9a-f]{40}$/);
export const workspaceId=z.uuid();
export const workspaceRequest=z.strictObject({id:workspaceId,agent:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),base:hash,context:z.string().min(1).max(2048).refine(s=>s.trim().length>0)});
export const workspaceSchema=workspaceRequest.extend({creator:z.string().min(1).max(64),request_hash:hash,repo:z.string().regex(/^ace-[0-9a-f]{48}$/),branch:storeName,created_at:z.number().int(),expires_at:z.number().int(),ready:z.boolean(),initialization_token:workspaceId.nullable(),initializing_until:z.number().int(),seed:gitHash.nullable(),commit:gitHash.nullable(),version:hash.nullable(),tokens_used:z.number().int().min(0).max(8),closed:z.boolean()});
export type Workspace=z.infer<typeof workspaceSchema>;
export const WORKSPACE_LIMIT=32;
export async function workspaceOperation(tx:DurableObjectTransaction,op:string,body:Record<string,unknown>){
 const list=await readState<Workspace[]>(tx,'native-workspaces')??[];
 if(op==='workspace-list')return{workspaces:list};
 if(op==='workspace-restore'){
  const incoming=z.array(workspaceSchema).max(WORKSPACE_LIMIT).parse(body.workspaces);
  if(new Set(incoming.map(w=>w.id)).size!==incoming.length||list.length&&JSON.stringify(list)!==JSON.stringify(incoming))throw new HttpError(409,'restored workspaces differ');
  await writeState(tx,'native-workspaces',incoming);return{restored:true};
 }
 if(op==='workspace-create'){
  const args=workspaceSchema.parse(body.workspace),old=list.find(w=>w.id===args.id);
  if(old){if(old.request_hash!==args.request_hash)throw new HttpError(409,'workspace identity was reused');return old;}
  if(list.length>=WORKSPACE_LIMIT)throw new HttpError(409,'project workspace limit reached');
  if(!(await readState<{version:string}[]>(tx,'native-entries')??[]).some(e=>e.version===args.base))throw new HttpError(409,'workspace base is unpublished');
  list.push(args);await writeState(tx,'native-workspaces',list);return args;
 }
 const w=list.find(w=>w.id===workspaceId.parse(body.id));if(!w)throw new HttpError(404,'workspace not found');
 if(op==='workspace-get')return w;
 if(op==='workspace-close'){w.closed=true;}
 else {
  if(w.closed||Date.now()>=w.expires_at)throw new HttpError(409,'workspace closed or expired');
  if(op==='workspace-initialize'){
   if(w.ready)return w;
   if(w.initializing_until>Date.now())throw new HttpError(409,'workspace creation is in progress; retry the same request');
   w.initialization_token=workspaceId.parse(body.token);w.initializing_until=Date.now()+120000;
  }else if(op==='workspace-ready'||op==='workspace-release'){
   if(w.initialization_token!==body.token)throw new HttpError(409,'workspace initialization changed');
   if(op==='workspace-ready')w.ready=true;w.initializing_until=0;w.initialization_token=null;
  }
  else if(op==='workspace-token'){
   if(!w.ready||w.commit)throw new HttpError(409,'workspace does not accept new credentials');
   if(w.tokens_used>=8)throw new HttpError(429,'workspace credential limit reached');w.tokens_used++;
  }else if(op==='workspace-seed'){
   if(!w.ready||w.commit)throw new HttpError(409,'workspace seed cannot change');
   const seed=gitHash.parse(body.commit);if(w.seed&&w.seed!==seed)throw new HttpError(409,'workspace seed cannot change');w.seed=seed;
  }else if(op==='workspace-pin'){
   const commit=gitHash.parse(body.commit);if(!w.seed||commit===w.seed)throw new HttpError(409,'workspace needs a changed proposal after its seed');
   if(w.commit&&w.commit!==commit)throw new HttpError(409,'workspace proposal is already pinned');w.commit=commit;
  }else if(op==='workspace-retain'){
   if(w.commit!==body.commit)throw new HttpError(409,'workspace proposal changed');
   const version=hash.parse(body.version);if(w.version&&w.version!==version)throw new HttpError(409,'workspace native version differs');w.version=version;
  }else throw new HttpError(404,'workspace operation not found');
 }
 await writeState(tx,'native-workspaces',list);return w;
}
