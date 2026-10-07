// Project permissions cover native files and every alternate resource/MCP route.
import {z} from 'zod';
import {type Env,HttpError,identifier,hash,json,strictJson} from './contracts';
import type {Identity} from './accounts';
const memberName=z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/),role=z.enum(['owner','writer','reader']);
const subject=(actor:Identity)=>actor.kind+':'+actor.username;
export async function audit(env:Env,actor:Identity,project:string,action:string,resource:string,id=crypto.randomUUID()){
 await env.DB.prepare('INSERT INTO project_audit (id,project,actor,action,resource,recorded_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
  .bind(id,project,subject(actor),action,resource.slice(0,256),Date.now()).run();
}
export async function access(env:Env,actor:Identity,project:string,operation:'read'|'write'|'own'='read'){
 identifier.parse(project);if(actor.kind==='operator')return 'owner' as const;
 const member=await env.DB.prepare('SELECT role FROM native_project_members WHERE project = ? AND username = ?').bind(project,actor.username).first<{role:z.infer<typeof role>}>();
 if(!member)throw new HttpError(404,'project not found');
 if(operation==='own'&&member.role!=='owner'||operation!=='read'&&(member.role==='reader'||actor.role==='reader'))throw new HttpError(403,'project permission does not allow this action');
 return member.role;
}
export async function ensure(env:Env,actor:Identity,project:string){
 identifier.parse(project);if(actor.role==='reader')throw new HttpError(403,'read-only workspace account');
 const nonce=crypto.randomUUID(),stamp=Date.now(),creator=subject(actor);
 // D1 batch is atomic. The private nonce grants membership only to this creation,
 // never to a revoked original creator on a subsequent upload.
 const result=await env.DB.batch([
  env.DB.prepare('INSERT INTO native_projects (name,creator,creation_nonce,created_at) VALUES (?,?,?,?) ON CONFLICT(name) DO NOTHING').bind(project,creator,nonce,stamp),
  ...(actor.kind==='account'?[env.DB.prepare("INSERT INTO native_project_members (project,username,role,added_by,created_at) SELECT name,?,'owner',?,? FROM native_projects WHERE name = ? AND creation_nonce = ? ON CONFLICT(project,username) DO NOTHING").bind(actor.username,creator,stamp,project,nonce)]:[])
 ]);
 await access(env,actor,project,'write');if(result[0]!.meta.changes===1)await audit(env,actor,project,'project.create',project);
 return project;
}
export async function list(env:Env,actor:Identity){
 const sql=actor.kind==='operator'?env.DB.prepare("SELECT name,created_at,legacy,'owner' AS role FROM native_projects ORDER BY created_at DESC LIMIT 100"):
 env.DB.prepare('SELECT p.name,p.created_at,p.legacy,m.role FROM native_projects p JOIN native_project_members m ON m.project = p.name WHERE m.username = ? ORDER BY p.created_at DESC LIMIT 100').bind(actor.username);
 return json({projects:(await sql.all()).results,scope:'explicit_project_membership'});
}
export async function listStores(env:Env,actor:Identity){
 const statement=actor.kind==='operator'?env.DB.prepare('SELECT name,version_count,tip,updated_at FROM native_stores ORDER BY updated_at DESC LIMIT 100'):
 env.DB.prepare('SELECT s.name,s.version_count,s.tip,s.updated_at,m.role AS project_role FROM native_stores s JOIN native_project_members m ON m.project = s.name WHERE m.username = ? ORDER BY s.updated_at DESC LIMIT 100').bind(actor.username);
 return json({stores:(await statement.all()).results,scope:'private_project_membership',account_roles:['admin','writer','reader']});
}
export async function create(env:Env,actor:Identity,input:Uint8Array){const args=z.strictObject({name:identifier}).parse(strictJson(new TextDecoder().decode(input)));await ensure(env,actor,args.name);return json({name:args.name,created:true},201);}
export async function members(env:Env,actor:Identity,project:string){await access(env,actor,project,'own');return json({members:(await env.DB.prepare('SELECT username,role,created_at FROM native_project_members WHERE project = ? ORDER BY username LIMIT 100').bind(project).all()).results});}
export async function grant(env:Env,actor:Identity,project:string,input:Uint8Array){
 await access(env,actor,project,'own');const args=z.strictObject({username:memberName,role}).parse(strictJson(new TextDecoder().decode(input)));
 if(!await env.DB.prepare('SELECT username FROM native_users WHERE username = ?').bind(args.username).first())throw new HttpError(404,'account not found');
 const result=await env.DB.prepare(`INSERT INTO native_project_members (project,username,role,added_by,created_at) VALUES (?,?,?,?,?)
 ON CONFLICT(project,username) DO UPDATE SET role = excluded.role,added_by = excluded.added_by
 WHERE native_project_members.role != 'owner' OR excluded.role = 'owner' OR (SELECT COUNT(*) FROM native_project_members WHERE project = ? AND role = 'owner') > 1`)
 .bind(project,args.username,args.role,subject(actor),Date.now(),project).run();
 if(result.meta.changes!==1)throw new HttpError(409,'keep at least one project owner');
 await audit(env,actor,project,'member.grant',args.username+':'+args.role);return json({username:args.username,role:args.role});
}
export async function revoke(env:Env,actor:Identity,project:string,username:string){
 await access(env,actor,project,'own');memberName.parse(username);
 const result=await env.DB.prepare("DELETE FROM native_project_members WHERE project = ? AND username = ? AND (role != 'owner' OR (SELECT COUNT(*) FROM native_project_members WHERE project = ? AND role = 'owner') > 1)").bind(project,username,project).run();
 if(result.meta.changes!==1)throw new HttpError(409,'member absent or last project owner');
 await audit(env,actor,project,'member.revoke',username);return json({revoked:true});
}
export async function history(env:Env,actor:Identity,project:string){await access(env,actor,project);return json({events:(await env.DB.prepare('SELECT id,actor,action,resource,recorded_at FROM project_audit WHERE project = ? ORDER BY recorded_at DESC,id DESC LIMIT 100').bind(project).all()).results});}
export async function resource(env:Env,actor:Identity,kind:'experiment'|'generation'|'judgement',id:string,project?:string){
 if(actor.kind==='operator')return;
 const record=await env.DB.prepare('SELECT project FROM project_resource_owners WHERE kind = ? AND id = ?').bind(kind,id).first<{project:string}>();
 if(!record||project!==undefined&&record.project!==project)throw new HttpError(404,'resource not found');await access(env,actor,record.project);
}
export async function claim(env:Env,actor:Identity,kind:'experiment'|'generation'|'judgement',id:string,project:string){
 await ensure(env,actor,project);await env.DB.prepare('INSERT INTO project_resource_owners (kind,id,project) VALUES (?,?,?) ON CONFLICT(kind,id) DO NOTHING').bind(kind,id,project).run();
 const record=await env.DB.prepare('SELECT project FROM project_resource_owners WHERE kind = ? AND id = ?').bind(kind,id).first<{project:string}>();
 if(record?.project!==project)throw new HttpError(404,'resource belongs to a different project');
}
export function selected(request:Request,actor:Identity,fallback?:string){
 const chosen=request.headers.get('x-ace-project')??fallback??(actor.kind==='operator'?'legacy-control-plane':null);
 if(!chosen)throw new HttpError(400,'select the project with X-ACE-Project');return identifier.parse(chosen);
}
export async function artifact(env:Env,actor:Identity,id:string,project?:string){
 hash.parse(id);if(actor.kind==='operator')return;
 const record=project?await env.DB.prepare('SELECT project FROM project_artifacts WHERE hash = ? AND project = ?').bind(id,project).first<{project:string}>():
 await env.DB.prepare('SELECT a.project FROM project_artifacts a JOIN native_project_members m ON m.project = a.project WHERE a.hash = ? AND m.username = ? LIMIT 1').bind(id,actor.username).first<{project:string}>();
 if(!record)throw new HttpError(404,'artifact not found');await access(env,actor,record.project);
}
export async function attachArtifact(env:Env,actor:Identity,id:string,project:string){await ensure(env,actor,project);await env.DB.prepare('INSERT INTO project_artifacts (project,hash) VALUES (?,?) ON CONFLICT(project,hash) DO NOTHING').bind(project,hash.parse(id)).run();}
export async function grantLegacyToFirstAdmin(env:Env,username:string){
 await env.DB.prepare("INSERT INTO native_project_members (project,username,role,added_by,created_at) SELECT name,?,'owner','bootstrap:first-administrator',? FROM native_projects WHERE creator = 'operator:operator' ON CONFLICT(project,username) DO NOTHING").bind(username,Date.now()).run();
}

export async function reserveModel(env:Env,actor:Identity,kind:'generation'|'judgement',id:string,project:string){
 await ensure(env,actor,project);
 const owner=await env.DB.prepare('SELECT project FROM project_resource_owners WHERE kind = ? AND id = ?').bind(kind,id).first<{project:string}>();
 if(!owner&&actor.kind!=='operator'){
  const prefix=(kind==='generation'?'generations/':'judgements/')+id+'/';
  if(await env.ARTIFACTS.head(prefix+'manifest.json')||await env.ARTIFACTS.head(prefix+'record.json'))throw new HttpError(404,'legacy resource requires operator assignment');
 }
 await claim(env,actor,kind,id,project);
}
