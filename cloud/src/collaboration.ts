import {z} from 'zod';
import {type Env,HttpError,coordinate,json,hash,sha256,strictJson} from './contracts';
import type {Identity} from './accounts';
import * as projects from './projects';
import {loadVersion,readFile,readRefs,nativeHash,versionSchema,putObject,putVersion,appendEntry,appendRef,filename,type NativeEntry,type NativeRef,storeName} from './native-store';
import {edits,lines,mergeText,mergeBase} from './source-merge';
import {reviewId,type Review,type Resolution,approved} from './review-state';
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const subject=(actor:Identity)=>actor.kind+':'+actor.username;
const name=(store:string)=>'NATIVE-STORE-'+storeName.parse(store);
const text=z.string().min(1).max(2048).refine(s=>s.trim().length>0);
export async function comparison(env:Env,store:string,left:string,right:string){
 const log=await coordinate(env,name(store),'native-log') as {entries:NativeEntry[]};if(![left,right].every(id=>log.entries.some(e=>e.version===hash.parse(id))))throw new HttpError(404,'comparison version is unpublished');
 const a=await loadVersion(env,store,left),b=await loadVersion(env,store,right),paths=[...new Set([...Object.keys(a.version.files),...Object.keys(b.version.files)])].sort(),changes=[];
 for(const path of paths){const before=a.version.files[path]??null,after=b.version.files[path]??null;if(before===after)continue;
 let beforeText:string[]|null=null,afterText:string[]|null=null;
 if(changes.length<20){for(const [label,id]of [['before',before],['after',after]] as const){if(!id)continue;const size=await env.ARTIFACTS.head(`native-stores/${store}/objects/${id}`);if(!size)throw new HttpError(503,'comparison source missing');if(size.size<=65536){const data=new Uint8Array(await(await readFile(env,store,'objects',id)).arrayBuffer());if(label==='before')beforeText=lines(data);else afterText=lines(data);}}}
 changes.push({path,change:!before?'added':!after?'removed':'modified',before,after,before_text:beforeText,after_text:afterText,text_edits:beforeText&&afterText?edits(beforeText,afterText).map(e=>({start_line:e.start+1,removed_lines:e.end-e.start,replacement:e.lines})):null});
 }
 return{left,right,changes,verified:true,text_preview_limit:{files:20,bytes_per_file:65536,lines_per_file:256}};
}
export async function listReviews(env:Env,actor:Identity,store:string){await projects.access(env,actor,store);const result=await coordinate(env,name(store),'review-list') as {reviews:Review[]};const refs=await(await readRefs(env,store)).json() as {heads:Record<string,string>};return json({reviews:result.reviews.map(r=>({...r,events:undefined,resolutions:undefined,request:undefined,stale:refs.heads[r.source_branch]!==r.source||refs.heads[r.target_branch]!==r.target}))});}
export async function getReview(env:Env,actor:Identity,store:string,id:string){await projects.access(env,actor,store);return json(await coordinate(env,name(store),'review-get',{id:reviewId.parse(id)}));}
export async function createReview(env:Env,actor:Identity,store:string,input:Uint8Array){await projects.access(env,actor,store,'write');const args=z.strictObject({id:reviewId,title:text,source_branch:storeName,target_branch:storeName,source:hash,target:hash}).parse(strictJson(new TextDecoder().decode(input)));const review=await coordinate(env,name(store),'review-create',{...args,author:subject(actor)});await projects.audit(env,actor,store,'review.create',args.id,'review-create-'+args.id);return json(review,201);}
export async function reviewEvent(env:Env,actor:Identity,store:string,id:string,input:Uint8Array){
 const role=await projects.access(env,actor,store,'write'),args=z.strictObject({id:reviewId,type:z.enum(['comment','approve','request_changes','refresh','close']),body:text,revision:z.number().int().positive(),source:hash,target:hash,path:filename.optional(),line:z.number().int().min(1).max(256).optional()}).parse(strictJson(new TextDecoder().decode(input)));
 if(args.line&&!args.path)throw new HttpError(400,'line comments require a file');
 if(args.path){const result=await comparison(env,store,args.target,args.source);const change=result.changes.find(c=>c.path===args.path);if(!change)throw new HttpError(400,'comment file is not in this comparison');if(args.line&&(!change.after_text||args.line>change.after_text.length))throw new HttpError(400,'comment line is outside the source preview');}
 const value=await coordinate(env,name(store),'review-event',{id:reviewId.parse(id),actor:subject(actor),owner:role==='owner',event:{...args,actor:subject(actor)}});await projects.audit(env,actor,store,'review.'+args.type,id,'review-event-'+args.id);return json(value);
}
async function eligible(env:Env,store:string,review:Review){const people=new Set(review.events.filter(e=>['approve','request_changes'].includes(e.type)).map(e=>e.actor)),result:string[]=[];
 for(const person of people){if(person==='operator:operator'){result.push(person);continue;}const username=person.slice('account:'.length),member=await env.DB.prepare("SELECT m.role AS project_role,u.role FROM native_project_members m JOIN native_users u ON u.username=m.username WHERE m.project=? AND m.username=?").bind(store,username).first<{project_role:string;role:string}>();if(member&&member.project_role!=='reader'&&member.role!=='reader')result.push(person);}return result;
}
export async function mergeReview(env:Env,actor:Identity,store:string,id:string,input:Uint8Array){
 await projects.access(env,actor,store,'write');const args=z.strictObject({base:hash.optional()}).parse(strictJson(new TextDecoder().decode(input)));let review=await coordinate(env,name(store),'review-get',{id:reviewId.parse(id)}) as Review;
 if(!review.merge){
  const allowed=await eligible(env,store,review);if(review.status!=='open'||!approved(review,allowed))throw new HttpError(409,'independent approval is required before merging');
  const {base,files,newObjects,conflicts,log,refs}=await mergePlan(env,store,review,args.base);
  if(conflicts.length)return json({status:'conflicted',base,conflicts,source_versions_unchanged:true,evaluation_required:true},409);
  const version={schema_version:1 as const,parents:[review.target,review.source].sort(),kind:{kind:'source' as const},message:'Merge review '+review.id+': '+review.title,files},versionId=await nativeHash(version),sealed={version,content_hash:versionId};versionSchema.parse(sealed);
  for(const [h,bytes]of newObjects)await putObject(env,store,h,bytes);await putVersion(env,store,versionId,encode(sealed));
  const sequence=log.entries.length+1,refSequence=refs.events.length+1,entry={schema_version:1 as const,sequence,previous:log.tip,version:versionId,content_hash:await nativeHash([1,sequence,log.tip,versionId])},ref={schema_version:1 as const,sequence:refSequence,previous:refs.tip,branch:review.target_branch,expected:review.target,target:versionId,content_hash:await nativeHash([1,refSequence,refs.tip,review.target_branch,review.target,versionId])};
  review=await coordinate(env,name(store),'review-merge',{id,actor:subject(actor),eligible:allowed,entry,ref}) as Review;
 }
 // Repair partial immutable/D1 mirrors on retry; the merge authority is atomic.
 await appendEntry(env,store,encode(review.merge!.entry),actor.username);await appendRef(env,store,encode(review.merge!.ref));await projects.audit(env,actor,store,'review.merge',review.merge!.version,'review-merge-'+id);return json({status:'merged',review,evaluation_required:true,qualification:'source_only'});
}

export async function mergePlan(env:Env,store:string,review:Review,explicitBase?:string){
  const log=await coordinate(env,name(store),'native-log') as {entries:NativeEntry[];tip:string|null},refs=await(await readRefs(env,store)).json() as {events:NativeRef[];heads:Record<string,string>;tip:string|null};
  if(refs.heads[review.source_branch]!==review.source||refs.heads[review.target_branch]!==review.target)throw new HttpError(409,'branches changed; refresh and review again');
  const versions=new Map<string,Awaited<ReturnType<typeof loadVersion>>>();for(const entry of log.entries)versions.set(entry.version,await loadVersion(env,store,entry.version));
  const base=mergeBase(new Map([...versions].map(([id,v])=>[id,v.version.parents])),review.target,review.source,explicitBase),b=versions.get(base)!.version.files,o=versions.get(review.target)!.version.files,t=versions.get(review.source)!.version.files;
  const paths=[...new Set([...Object.keys(b),...Object.keys(o),...Object.keys(t)])].sort();if(paths.length>4096)throw new HttpError(413,'browser merge supports at most 4096 files');
  const files:Record<string,string>={},newObjects:Map<string,Uint8Array>=new Map(),conflicts=[];
  for(const path of paths){const bb=b[path],ob=o[path],tb=t[path];let chosen:string|undefined;
   if(ob===tb)chosen=ob;else if(ob===bb)chosen=tb;else if(tb===bb)chosen=ob;else{
    let bytes:Uint8Array|null=null;if(bb&&ob&&tb){const data:Uint8Array[]=[];for(const h of [bb,ob,tb]){const object=await env.ARTIFACTS.head(`native-stores/${store}/objects/${h}`);if(!object)throw new HttpError(503,'merge object missing');if(object.size>65536)break;data.push(new Uint8Array(await(await readFile(env,store,'objects',h)).arrayBuffer()));}if(data.length===3)bytes=mergeText(data[0]!,data[1]!,data[2]!);}
    if(bytes){chosen=await sha256(bytes);newObjects.set(chosen,bytes);}else{conflicts.push({path,base:bb??null,ours:ob??null,theirs:tb??null});if(conflicts.length>128)throw new HttpError(413,'browser resolution supports at most 128 conflicting files');continue;}
   }if(chosen)files[path]=chosen;
  }
  return{base,files,newObjects,conflicts,log,refs};
}
export async function reviewConflicts(env:Env,actor:Identity,store:string,id:string,base?:string){
 await projects.access(env,actor,store);const review=await coordinate(env,name(store),'review-get',{id:reviewId.parse(id)}) as Review;if(review.status!=='open')throw new HttpError(409,'review is not open');
 const plan=await mergePlan(env,store,review,base);return json({base:plan.base,revision:review.revision,source:review.source,target:review.target,conflicts:plan.conflicts,source_branch:review.source_branch,target_branch:review.target_branch});
}
const resolutionSchema=z.strictObject({request_id:reviewId,revision:z.number().int().positive(),source:hash,target:hash,base:hash.optional(),resolutions:z.array(z.strictObject({path:filename,choice:z.enum(['ours','theirs','text','delete']),text:z.string().refine(s=>new TextEncoder().encode(s).length<=65536).optional()}).refine(r=>r.choice==='text'?r.text!==undefined:r.text===undefined)).min(1).max(128)});
export async function resolveReview(env:Env,actor:Identity,store:string,id:string,input:Uint8Array){
 const owner=await projects.access(env,actor,store,'write'),args=resolutionSchema.parse(strictJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(input))),who=subject(actor),requestHash=await nativeHash([who,args]);
 const review=await coordinate(env,name(store),'review-get',{id:reviewId.parse(id)}) as Review;
 if(who!==review.author&&owner!=='owner')throw new HttpError(403,'author or project owner required');
 let resolved=await coordinate(env,name(store),'review-resolution-get',{id,request_id:args.request_id,request_hash:requestHash}) as Resolution|null;
 if(!resolved){
  if(review.status!=='open'||args.revision!==review.revision||args.source!==review.source||args.target!==review.target)throw new HttpError(409,'review changed; compare again');
  const plan=await mergePlan(env,store,review,args.base),choices=new Map(args.resolutions.map(r=>[r.path,r]));
  if(choices.size!==args.resolutions.length||choices.size!==plan.conflicts.length||plan.conflicts.some(c=>!choices.has(c.path)))throw new HttpError(400,'resolve each conflicting file exactly once; no other files may be replaced');
  if(args.resolutions.reduce((sum,r)=>sum+new TextEncoder().encode(r.text??'').length,0)>524288)throw new HttpError(413,'resolution text exceeds 512 KiB');
  for(const conflict of plan.conflicts){const choice=choices.get(conflict.path)!;if(choice.choice==='text'){const bytes=new TextEncoder().encode(choice.text!),h=await sha256(bytes);plan.files[conflict.path]=h;plan.newObjects.set(h,bytes);}else if(choice.choice!=='delete'){const selected=choice.choice==='ours'?conflict.ours:conflict.theirs;if(selected)plan.files[conflict.path]=selected;}}
  const version={schema_version:1 as const,parents:[review.source,review.target].sort(),kind:{kind:'source' as const},message:'Resolve review '+id+': '+args.request_id,files:plan.files},versionId=await nativeHash(version),sealed={version,content_hash:versionId};versionSchema.parse(sealed);
  for(const [h,bytes]of plan.newObjects)await putObject(env,store,h,bytes);await putVersion(env,store,versionId,encode(sealed));
  const seq=plan.log.entries.length+1,refSeq=plan.refs.events.length+1,entry={schema_version:1 as const,sequence:seq,previous:plan.log.tip,version:versionId,content_hash:await nativeHash([1,seq,plan.log.tip,versionId])},ref={schema_version:1 as const,sequence:refSeq,previous:plan.refs.tip,branch:review.source_branch,expected:review.source,target:versionId,content_hash:await nativeHash([1,refSeq,plan.refs.tip,review.source_branch,review.source,versionId])};
  resolved=await coordinate(env,name(store),'review-resolve',{id,request_id:args.request_id,request_hash:requestHash,actor:who,owner:owner==='owner',revision:args.revision,source:args.source,target:args.target,entry,ref}) as Resolution;
 }
 await appendEntry(env,store,encode(resolved.entry),actor.username);await appendRef(env,store,encode(resolved.ref));await projects.audit(env,actor,store,'review.resolve',id,'review-resolution-'+args.request_id);
 return json({version:resolved.version,review:await coordinate(env,name(store),'review-get',{id}),new_approval_required:true,evaluation_required:true});
}
