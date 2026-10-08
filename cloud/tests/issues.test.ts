import {it,expect} from 'vitest';
import {env} from 'cloudflare:test';
import {ensure,audit} from '../src/projects';
import {createIssue,readIssue,issueEvent,notifications,readNotifications,type Issue} from '../src/issues';
import {capture,copyChunk,restoreChunk,restoreMetadata} from '../src/backups';
import {coordinate} from '../src/contracts';
const owner={kind:'operator',username:'operator',role:'admin'} as const;
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
async function fixture(){const project='tasks-'+crypto.randomUUID(),username='member-'+crypto.randomUUID().slice(0,8);await ensure(env,owner,project);await env.DB.prepare("INSERT INTO native_users (username,role,salt,password_hash,created_at) VALUES (?,'writer',?,?,?)").bind(username,'a'.repeat(32),'b'.repeat(64),Date.now()).run();await env.DB.prepare("INSERT INTO native_project_members (project,username,role,added_by,created_at) VALUES (?,?,'writer','test',?)").bind(project,username,Date.now()).run();const member={kind:'account',username,role:'writer'} as const,args={id:crypto.randomUUID(),title:'Repair calculator',body:'<script>untrusted task description</script>',assignee:username,version:null};return{project,member,args};}
it('retains assigned tasks, inert comments and idempotent status changes with explicit revisions',async()=>{
 const f=await fixture(),first=await(await createIssue(env,owner,f.project,encode(f.args))).json() as Issue;expect(first).toMatchObject({status:'open',revision:1,assignee:f.member.username});await createIssue(env,owner,f.project,encode(f.args));
 const event={id:crypto.randomUUID(),revision:1,type:'update',body:'Working on the error',status:'in_progress'};await issueEvent(env,f.member,f.project,first.id,encode(event));await issueEvent(env,f.member,f.project,first.id,encode(event));const current=await(await readIssue(env,f.member,f.project,first.id)).json() as Issue;expect(current.status).toBe('in_progress');expect(current.events).toHaveLength(1);expect(current.body).toBe(f.args.body);
 await expect(issueEvent(env,f.member,f.project,first.id,encode({...event,body:'different retry'}))).rejects.toThrow('identity');
});
it('concurrent task changes accept one revision and reject stale updates rather than losing comments',async()=>{
 const f=await fixture(),issue=await(await createIssue(env,owner,f.project,encode(f.args))).json() as Issue;
 const results=await Promise.allSettled([issueEvent(env,owner,f.project,issue.id,encode({id:crypto.randomUUID(),revision:1,type:'comment',body:'Review this case'})),issueEvent(env,f.member,f.project,issue.id,encode({id:crypto.randomUUID(),revision:1,type:'update',body:'Completed',status:'done'}))]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await(await readIssue(env,owner,f.project,issue.id)).json() as Issue).revision).toBe(2);
});
it('rejects unpublished source, outsiders, read-only updates and assigning tasks to a reader',async()=>{
 const f=await fixture();await expect(createIssue(env,owner,f.project,encode({...f.args,version:'f'.repeat(64)}))).rejects.toThrow('unpublished');await expect(createIssue(env,{...f.member,role:'reader'},f.project,encode(f.args))).rejects.toThrow('permission');await expect(notifications(env,{...f.member,username:'outsider'},f.project)).rejects.toThrow('project not found');
 await env.DB.prepare("UPDATE native_users SET role='reader' WHERE username=?").bind(f.member.username).run();await expect(createIssue(env,owner,f.project,encode(f.args))).rejects.toThrow('current project write access');
});
it('keeps activity private, deduplicates retries, and bounds read cursors so future events remain unread',async()=>{
 const f=await fixture();await audit(env,owner,f.project,'review.comment','review-id','fixed-notification');await audit(env,owner,f.project,'review.comment','review-id','fixed-notification');const first=await(await notifications(env,f.member,f.project)).json() as {unread_count:number;events:{action:string}[];through:number};expect(first.events.filter(e=>e.action==='review.comment')).toHaveLength(1);expect(first.unread_count).toBeGreaterThan(0);
 await readNotifications(env,{...f.member,role:'reader'},f.project,encode({through:Number.MAX_SAFE_INTEGER}));expect((await(await notifications(env,f.member,f.project)).json() as {unread_count:number}).unread_count).toBe(0);await audit(env,owner,f.project,'review.merge','source-id');expect((await(await notifications(env,f.member,f.project)).json() as {unread_count:number}).unread_count).toBe(1);
});
it('isolated restoration preserves tasks, comments, notification sequences and read cursors',async()=>{
 const f=await fixture(),issue=await(await createIssue(env,owner,f.project,encode(f.args))).json() as Issue;await issueEvent(env,f.member,f.project,issue.id,encode({id:crypto.randomUUID(),revision:1,type:'comment',body:'Keep this learning'}));await readNotifications(env,f.member,f.project,encode({through:Number.MAX_SAFE_INTEGER}));
 const id='backup-'+crypto.randomUUID(),inventory=await capture(env,id),items=await copyChunk(env,id,inventory.keys);await restoreChunk(env,id,items);const result=await restoreMetadata(env,id,inventory,items),restored=await coordinate({...env,COORDINATORS:env.RESTORE_COORDINATORS!},'RESTORE-'+id+'-NATIVE-'+f.project,'issue-get',{id:issue.id}) as Issue;expect(restored.events[0]!.body).toBe('Keep this learning');expect((await env.RESTORE_DB!.prepare(`SELECT COUNT(*) AS n FROM ${result.namespace}project_notifications WHERE project=?`).bind(f.project).first<{n:number}>())?.n).toBeGreaterThan(0);
});
