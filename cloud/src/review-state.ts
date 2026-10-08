import {z} from 'zod';
import {HttpError,hash} from './contracts';
import {storeName,entrySchema,refSchema,type NativeEntry,type NativeRef} from './native-store';
export const reviewId=z.string().uuid();
const actor=z.string().regex(/^(account:[a-z0-9][a-z0-9_-]{2,31}|operator:operator)$/);
const text=z.string().min(1).max(2048).refine(s=>s.trim().length>0);
export const createSchema=z.strictObject({id:reviewId,title:text,source_branch:storeName,target_branch:storeName,source:hash,target:hash,author:actor});
export type Review={id:string;title:string;source_branch:string;target_branch:string;source:string;target:string;author:string;status:'open'|'closed'|'merged';revision:number;created_at:number;events:ReviewEvent[];request?:z.infer<typeof createSchema>;merge?:{version:string;entry:NativeEntry;ref:NativeRef}};
export type ReviewEvent={id:string;actor:string;type:'comment'|'approve'|'request_changes'|'refresh'|'close'|'merge';body:string;revision:number;source:string;target:string;path?:string;line?:number;recorded_at:number};
export function approved(review:Review,eligible?:string[]){const latest=new Map<string,string>();for(const event of review.events)if(event.revision===review.revision&&['approve','request_changes'].includes(event.type)&&event.actor!==review.author&&(!eligible||eligible.includes(event.actor)))latest.set(event.actor,event.type);return [...latest.values()].includes('approve')&&![...latest.values()].includes('request_changes');}
export async function reviewOperation(tx:DurableObjectTransaction,op:string,body:Record<string,unknown>):Promise<unknown>{
 const reviews=await tx.get<Review[]>('native-reviews')??[];
 if(op==='review-list')return{reviews};
 if(op==='review-restore'){const incoming=body.reviews as Review[];if(!Array.isArray(incoming)||incoming.length>32)throw new HttpError(409,'restored reviews exceed bounds');if(reviews.length&&JSON.stringify(reviews)!==JSON.stringify(incoming))throw new HttpError(409,'restored reviews differ');await tx.put('native-reviews',incoming);return{restored:true};}
 const heads=await tx.get<Record<string,string>>('native-ref-heads')??{};
 if(op==='review-create'){
  const args=createSchema.parse(body),old=reviews.find(r=>r.id===args.id);if(old){for(const key of Object.keys(args) as (keyof typeof args)[])if((old.request??old)[key]!==args[key])throw new HttpError(409,'review request identity was reused');return old;}
  if(reviews.length>=32)throw new HttpError(409,'project review limit reached');if(args.source_branch===args.target_branch||args.source===args.target||heads[args.source_branch]!==args.source||heads[args.target_branch]!==args.target)throw new HttpError(409,'review branch heads changed or are identical');
  const review:Review={...args,request:args,status:'open',revision:1,created_at:Date.now(),events:[]};await tx.put('native-reviews',[...reviews,review]);return review;
 }
 const review=reviews.find(r=>r.id===reviewId.parse(body.id));if(!review)throw new HttpError(404,'review not found');
 if(op==='review-get')return review;
 if(op==='review-merge'&&review.merge)return review;
 const who=actor.parse(body.actor);
 if(op==='review-merge'){
  if(review.status!=='open')throw new HttpError(409,'review is not open');
  if(review.events.length>=64)throw new HttpError(409,'review event limit reached');
  if(heads[review.source_branch]!==review.source||heads[review.target_branch]!==review.target||!approved(review,body.eligible as string[]))throw new HttpError(409,'branches changed or independent approval is missing');
  const entry=entrySchema.parse(body.entry),ref=refSchema.parse(body.ref),entries=await tx.get<NativeEntry[]>('native-entries')??[],refs=await tx.get<NativeRef[]>('native-ref-events')??[];
  if(entries.length>=256||refs.length>=1024||entry.sequence!==entries.length+1||entry.previous!==(entries.at(-1)?.content_hash??null)||ref.sequence!==refs.length+1||ref.previous!==(refs.at(-1)?.content_hash??null)||ref.branch!==review.target_branch||ref.expected!==review.target||ref.target!==entry.version||entries.some(e=>e.version===entry.version))throw new HttpError(409,'native history changed; retry merge');
  const publishers=await tx.get<Record<string,unknown>>('native-publishers')??{};publishers[entry.version]={username:who.split(':')[1],published_at:Date.now()};heads[ref.branch]=ref.target;
  await tx.put('native-entries',[...entries,entry]);await tx.put('native-publishers',publishers);await tx.put('native-ref-events',[...refs,ref]);await tx.put('native-ref-heads',heads);
  review.status='merged';review.merge={version:entry.version,entry,ref};review.events.push({id:review.id+'-merge',actor:who,type:'merge',body:'Merged source; new evaluation required.',revision:review.revision,source:review.source,target:review.target,recorded_at:Date.now()});
 }else{
  const event=z.strictObject({id:reviewId,actor,type:z.enum(['comment','approve','request_changes','refresh','close']),body:text,revision:z.number().int().positive(),source:hash,target:hash,path:z.string().max(2048).optional(),line:z.number().int().min(1).max(256).optional()}).parse(body.event);
  if(event.actor!==who)throw new HttpError(403,'review actor differs');
  const old=review.events.find(e=>e.id===event.id);if(old){const {recorded_at,...original}=old;if(JSON.stringify(original)!==JSON.stringify(event))throw new HttpError(409,'review event identity was reused');return review;}
  if(review.status!=='open')throw new HttpError(409,'review is not open');
  if(review.events.length>=64)throw new HttpError(409,'review event limit reached');
  if(event.actor!==who||event.revision!==review.revision||event.source!==review.source||event.target!==review.target)throw new HttpError(409,'review revision changed');
  if(event.type==='refresh'){if(who!==review.author&&body.owner!==true)throw new HttpError(403,'author or project owner required');if(!heads[review.source_branch]||!heads[review.target_branch])throw new HttpError(409,'review branch missing');review.source=heads[review.source_branch]!;review.target=heads[review.target_branch]!;review.revision++;}
  if(['approve','request_changes'].includes(event.type)){if(who===review.author)throw new HttpError(403,'a different contributor must review this request');if(heads[review.source_branch]!==review.source||heads[review.target_branch]!==review.target)throw new HttpError(409,'refresh changed branches before reviewing');}
  if(event.type==='close'){if(who!==review.author&&body.owner!==true)throw new HttpError(403,'author or project owner required');review.status='closed';}
  review.events.push({...event,recorded_at:Date.now()});
 }
 await tx.put('native-reviews',reviews);return review;
}
