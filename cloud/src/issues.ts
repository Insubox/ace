import {readState,writeState} from './paged-state';
import {z} from 'zod';
import {type Env,HttpError,json,strictJson,coordinate} from './contracts';
import {nativeHash} from './native-store';
import type {Identity} from './accounts';
import * as projects from './projects';
const uuid=z.uuid(),text=(max:number)=>z.string().min(1).max(max).refine(s=>s.trim().length>0);
const assignee=z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/).nullable();
const create=z.strictObject({id:uuid,title:text(256),body:text(2048),assignee,version:z.string().regex(/^[0-9a-f]{64}$/).nullable()});
const event=z.strictObject({id:uuid,revision:z.number().int().positive(),type:z.enum(['comment','update']),body:text(1024),status:z.enum(['open','in_progress','done']).optional(),assignee:assignee.optional()}).refine(e=>e.type==='update'||e.status===undefined&&e.assignee===undefined);
export type Issue={id:string;title:string;body:string;author:string;assignee:string|null;version:string|null;status:'open'|'in_progress'|'done';revision:number;request_hash:string;created_at:number;updated_at:number;events:(z.infer<typeof event>&{actor:string;request_hash:string;recorded_at:number})[]};
const name=(project:string)=>'NATIVE-STORE-'+project;
export async function issueOperation(tx:DurableObjectTransaction,op:string,body:Record<string,unknown>){
 const issues=await readState<Issue[]>(tx,'native-issues')??[];
 if(op==='issue-list')return{issues};
 if(op==='issue-restore'){const incoming=body.issues as Issue[];if(!Array.isArray(incoming)||incoming.length>64)throw new HttpError(409,'restored tasks exceed bounds');if(issues.length&&JSON.stringify(issues)!==JSON.stringify(incoming))throw new HttpError(409,'restored tasks differ');await writeState(tx,'native-issues',incoming);return{restored:true};}
 if(op==='issue-create'){
  const args=create.parse(body.request),old=issues.find(i=>i.id===args.id);if(old){if(old.request_hash!==body.request_hash)throw new HttpError(409,'task request identity was reused');return old;}
  if(issues.length>=64)throw new HttpError(409,'project task limit reached');
  if(args.version&&!(await readState<{version:string}[]>(tx,'native-entries')??[]).some(e=>e.version===args.version))throw new HttpError(409,'task source version is unpublished');
  const issue:Issue={...args,author:String(body.actor),status:'open',revision:1,request_hash:String(body.request_hash),created_at:Date.now(),updated_at:Date.now(),events:[]};issues.push(issue);await writeState(tx,'native-issues',issues);return issue;
 }
 const issue=issues.find(i=>i.id===uuid.parse(body.id));if(!issue)throw new HttpError(404,'task not found');if(op==='issue-get')return issue;
 if(op!=='issue-event')throw new HttpError(404,'task operation not found');const args=event.parse(body.request),old=issue.events.find(e=>e.id===args.id);
 if(old){if(old.request_hash!==body.request_hash)throw new HttpError(409,'task event identity was reused');return issue;}
 if(args.revision!==issue.revision)throw new HttpError(409,'task changed; reload before updating');if(issue.events.length>=16)throw new HttpError(409,'task event limit reached');
 if(args.type==='update'){if(args.status)issue.status=args.status;if(args.assignee!==undefined)issue.assignee=args.assignee;}
 issue.revision++;issue.updated_at=Date.now();issue.events.push({...args,actor:String(body.actor),request_hash:String(body.request_hash),recorded_at:Date.now()});await writeState(tx,'native-issues',issues);return issue;
}
async function checkAssignee(env:Env,project:string,username:string|null|undefined){if(!username)return;const member=await env.DB.prepare('SELECT m.role,u.role AS account_role FROM native_project_members m JOIN native_users u ON u.username=m.username WHERE m.project=? AND m.username=?').bind(project,username).first<{role:string;account_role:string}>();if(!member||member.role==='reader'||member.account_role==='reader')throw new HttpError(400,'assignee must have current project write access');}
export async function listIssues(env:Env,actor:Identity,project:string){await projects.access(env,actor,project);const result=await coordinate(env,name(project),'issue-list') as {issues:Issue[]};return json({issues:result.issues.map(i=>({...i,events:undefined}))});}
export async function readIssue(env:Env,actor:Identity,project:string,id:string){await projects.access(env,actor,project);return json(await coordinate(env,name(project),'issue-get',{id:uuid.parse(id)}));}
export async function createIssue(env:Env,actor:Identity,project:string,input:Uint8Array){await projects.access(env,actor,project,'write');const args=create.parse(strictJson(new TextDecoder().decode(input)));await checkAssignee(env,project,args.assignee);const subject=actor.kind+':'+actor.username,issue=await coordinate(env,name(project),'issue-create',{request:args,actor:subject,request_hash:await nativeHash([subject,args])});await projects.audit(env,actor,project,'issue.create',args.id,'issue-'+args.id);return json(issue,201);}
export async function issueEvent(env:Env,actor:Identity,project:string,id:string,input:Uint8Array){await projects.access(env,actor,project,'write');const args=event.parse(strictJson(new TextDecoder().decode(input)));await checkAssignee(env,project,args.assignee);const subject=actor.kind+':'+actor.username,issue=await coordinate(env,name(project),'issue-event',{id:uuid.parse(id),request:args,actor:subject,request_hash:await nativeHash([subject,args])});await projects.audit(env,actor,project,'issue.'+args.type,id,'issue-event-'+args.id);return json(issue);}
export async function notifications(env:Env,actor:Identity,project:string){await projects.access(env,actor,project);const subject=actor.kind+':'+actor.username,seen=await env.DB.prepare('SELECT through_sequence FROM notification_reads WHERE project=? AND actor=?').bind(project,subject).first<{through_sequence:number}>();
 const results=await env.DB.batch<Record<string,string|number|null>>([
  env.DB.prepare('SELECT sequence,actor,action,resource,recorded_at FROM project_notifications WHERE project=? AND actor!=? ORDER BY sequence DESC LIMIT 50').bind(project,subject),
  env.DB.prepare('SELECT COUNT(*) AS n FROM project_notifications WHERE project=? AND actor!=? AND sequence>?').bind(project,subject,seen?.through_sequence??0),
  env.DB.prepare('SELECT MAX(sequence) AS sequence FROM project_notifications WHERE project=?').bind(project)
 ]);return json({events:results[0]!.results,unread_count:Number(results[1]!.results[0]?.n??0),through:Number(results[2]!.results[0]?.sequence??0)});
}
export async function readNotifications(env:Env,actor:Identity,project:string,input:Uint8Array){await projects.access(env,actor,project);const args=z.strictObject({through:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).parse(strictJson(new TextDecoder().decode(input))),subject=actor.kind+':'+actor.username;
 await env.DB.prepare('INSERT INTO notification_reads (project,actor,through_sequence) SELECT ?,?,COALESCE(MAX(sequence),0) FROM project_notifications WHERE project=? AND sequence<=? ON CONFLICT(project,actor) DO UPDATE SET through_sequence=max(through_sequence,excluded.through_sequence)').bind(project,subject,project,args.through).run();return notifications(env,actor,project);
}
