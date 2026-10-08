import {env,SELF} from 'cloudflare:test';
import {it,expect} from 'vitest';
import {sha256,coordinate} from '../src/contracts';
import {ensure} from '../src/projects';
import {putObject,putVersion,appendEntry,appendRef,nativeHash,readRefs} from '../src/native-store';
import {createReview,reviewEvent,mergeReview,comparison,getReview} from '../src/collaboration';
import {mergeText} from '../src/source-merge';
import type {Review} from '../src/review-state';
const operator={username:'operator',kind:'operator',role:'admin'} as const;
const encode=(v:unknown)=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v));
async function fixture(conflict=false){
 const store='review-'+crypto.randomUUID();await ensure(env,operator,store);let sequence=0,previous:string|null=null;
 async function version(source:string,parents:string[]=[]){const bytes=encode(source),object=await sha256(bytes);await putObject(env,store,object,bytes);const version={schema_version:1,parents:parents.sort(),kind:{kind:'source'},message:'Review fixture',files:{'app.py':object}},id=await nativeHash(version);await putVersion(env,store,id,encode({version,content_hash:id}));sequence++;const entry={schema_version:1,sequence,previous,version:id,content_hash:await nativeHash([1,sequence,previous,id])};await appendEntry(env,store,encode(entry));previous=entry.content_hash;return id;}
 const base=await version('one\r\ntwo\r\nthree\r\n'),target=await version('ONE\r\ntwo\r\nthree\r\n',[base]),source=await version(conflict?'OTHER\r\ntwo\r\nthree\r\n':'one\r\ntwo\r\nTHREE\r\n',[base]);
 let refSequence=0,refTip:string|null=null;
 async function branch(branch:string,id:string,expected:string|null=null){refSequence++;const ref={schema_version:1,sequence:refSequence,previous:refTip,branch,expected,target:id,content_hash:await nativeHash([1,refSequence,refTip,branch,expected,id])};await appendRef(env,store,encode(ref));refTip=ref.content_hash;}
 await branch('main',target);await branch('feature',source);
 const username='reviewer-'+crypto.randomUUID().slice(0,8),reviewer={username,kind:'account',role:'writer'} as const;
 await env.DB.prepare("INSERT INTO native_users (username,role,salt,password_hash,created_at) VALUES (?,'writer',?,?,?)").bind(username,'a'.repeat(32),'b'.repeat(64),Date.now()).run();await env.DB.prepare("INSERT INTO native_project_members (project,username,role,added_by,created_at) VALUES (?,?,'writer','test',?)").bind(store,username,Date.now()).run();
 const args={id:crypto.randomUUID(),title:'Review exact native changes',source_branch:'feature',target_branch:'main',source,target};const review=await(await createReview(env,operator,store,encode(args))).json() as Review;
 const event=(type='approve',body='Reviewed exact source')=>({id:crypto.randomUUID(),type,body,revision:review.revision,source,target});return{store,base,source,target,review,reviewer,args,event,version,branch};
}
it('compares exact CRLF source and preserves bounded native merge semantics',async()=>{
 const f=await fixture(),result=await comparison(env,f.store,f.target,f.source);expect(result.changes[0]).toMatchObject({path:'app.py',before_text:['ONE\r\n','two\r\n','three\r\n'],after_text:['one\r\n','two\r\n','THREE\r\n']});
 expect(new TextDecoder().decode(mergeText(encode('a\nb\nc\n'),encode('A\nb\nc\n'),encode('a\nb\nC\n'))!)).toBe('A\nb\nC\n');expect(mergeText(encode('a\n'),encode('left\n'),encode('right\n'))).toBeNull();
});
it('requires independent approval, merges both parents atomically and repairs the same merge on retry',async()=>{
 const f=await fixture();await expect(mergeReview(env,operator,f.store,f.review.id,encode({}))).rejects.toThrow('approval');await expect(reviewEvent(env,operator,f.store,f.review.id,encode(f.event()))).rejects.toThrow('different contributor');
 const event=f.event();await reviewEvent(env,f.reviewer,f.store,f.review.id,encode(event));await reviewEvent(env,f.reviewer,f.store,f.review.id,encode(event));const result=await(await mergeReview(env,operator,f.store,f.review.id,encode({}))).json() as {review:Review};expect(result).toMatchObject({status:'merged',qualification:'source_only',evaluation_required:true});
 const version=result.review.merge!.version,retained=await env.ARTIFACTS.get(`native-stores/${f.store}/versions/${version}.json`);expect(await retained!.json()).toMatchObject({version:{parents:[f.target,f.source].sort(),kind:{kind:'source'}}});expect((await(await readRefs(env,f.store)).json() as {heads:Record<string,string>}).heads.main).toBe(version);
 await mergeReview(env,operator,f.store,f.review.id,encode({}));const log=await coordinate(env,'NATIVE-STORE-'+f.store,'native-log') as {entries:unknown[]};expect(log.entries).toHaveLength(4);
});
it('rejects stale approval after a branch advances and resets approvals on refresh',async()=>{
 const f=await fixture();await reviewEvent(env,f.reviewer,f.store,f.review.id,encode(f.event()));const next=await f.version('one\r\nTWO\r\nTHREE\r\n',[f.source]);await f.branch('feature',next,f.source);await expect(mergeReview(env,operator,f.store,f.review.id,encode({}))).rejects.toThrow('branches changed');
 await reviewEvent(env,operator,f.store,f.review.id,encode(f.event('refresh','Update heads')));await expect(mergeReview(env,operator,f.store,f.review.id,encode({}))).rejects.toThrow('approval');
});
it('retains conflicts without publishing a version and blocks revoked reviewers',async()=>{
 const f=await fixture(true);await reviewEvent(env,f.reviewer,f.store,f.review.id,encode(f.event()));expect((await mergeReview(env,operator,f.store,f.review.id,encode({}))).status).toBe(409);const log=await coordinate(env,'NATIVE-STORE-'+f.store,'native-log') as {entries:unknown[]};expect(log.entries).toHaveLength(3);
 await env.DB.prepare('DELETE FROM native_project_members WHERE project=? AND username=?').bind(f.store,f.reviewer.username).run();await expect(mergeReview(env,operator,f.store,f.review.id,encode({}))).rejects.toThrow('approval');
});
it('does not expose reviews or comparisons to outsiders and rejects line annotations outside changed files',async()=>{
 const f=await fixture();await expect(getReview(env,{username:'outsider',kind:'account',role:'admin'},f.store,f.review.id)).rejects.toThrow('project not found');expect((await SELF.fetch(`https://ace/v1/stores/${f.store}/compare?left=${f.target}&right=${f.source}`)).status).toBe(401);
 await expect(reviewEvent(env,f.reviewer,f.store,f.review.id,encode({...f.event('comment','Bad annotation'),path:'app.py',line:4}))).rejects.toThrow('outside');
 await reviewEvent(env,f.reviewer,f.store,f.review.id,encode({...f.event('comment','Keep exact line endings'),path:'app.py',line:3}));
});
it('an active request for changes prevents another contributor approval from merging',async()=>{
 const f=await fixture();await reviewEvent(env,f.reviewer,f.store,f.review.id,encode(f.event('request_changes','Correct source')));await expect(mergeReview(env,operator,f.store,f.review.id,encode({}))).rejects.toThrow('approval');await reviewEvent(env,f.reviewer,f.store,f.review.id,encode(f.event()));expect((await mergeReview(env,operator,f.store,f.review.id,encode({}))).status).toBe(200);
});
it('retries a retained close event without duplicating it or accepting a changed request',async()=>{
 const f=await fixture(),event=f.event('close','Close reviewed request');await reviewEvent(env,operator,f.store,f.review.id,encode(event));await reviewEvent(env,operator,f.store,f.review.id,encode(event));
 const retained=await(await getReview(env,operator,f.store,f.review.id)).json() as Review;expect(retained.status).toBe('closed');expect(retained.events).toHaveLength(1);
 await expect(reviewEvent(env,operator,f.store,f.review.id,encode({...event,body:'changed retry'}))).rejects.toThrow('identity');
});
