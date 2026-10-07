import {it,expect} from 'vitest';
import {env,SELF} from 'cloudflare:test';
import {coordinate,sha256} from '../src/contracts';
import {access,ensure,claim,resource,grant,revoke,reserveModel} from '../src/projects';
import type {Identity} from '../src/accounts';
const operator='local-tests-only-0123456789abcdef0123456789abcdef',password='isolated-project-test-password';
async function account(role:'admin'|'writer'|'reader'='writer'){
 const username='project-'+crypto.randomUUID().slice(0,8),post=(path:string,token:string,body:unknown)=>SELF.fetch('https://ace'+path,{method:'POST',headers:{authorization:'Bearer '+token,'CF-Connecting-IP':crypto.randomUUID()},body:JSON.stringify(body)});
 expect((await post('/v1/users',operator,{username,password,role})).status).toBe(201);
 const logged=await post('/v1/auth/login','',{username,password});expect(logged.status).toBe(200);const session=await logged.json() as {token:string};
 return{username,token:session.token,actor:{username,role,kind:'account'} as Identity};
}
const name=()=>'private-'+crypto.randomUUID();
const request=(a:{token:string},path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>SELF.fetch('https://ace'+path,{method,headers:{authorization:'Bearer '+a.token,...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
it('private native histories cannot be listed, guessed or written by unrelated accounts',async()=>{
 const alice=await account(),bob=await account('admin'),project=name(),bytes='private fixture source',id=await sha256(new TextEncoder().encode(bytes));
 expect((await request(alice,`/v1/stores/${project}/objects/${id}`,'PUT',bytes)).status).toBe(200);
 expect((await request(alice,`/v1/stores/${project}/objects/${id}`)).status).toBe(200);
 for(const method of ['GET','PUT'])expect((await request(bob,`/v1/stores/${project}/objects/${id}`,method,method==='PUT'?bytes:undefined)).status).toBe(404);
 expect((await request(bob,`/v1/stores/${project}`)).status).toBe(404);
 const list=await(await request(bob,'/v1/projects')).json() as {projects:{name:string}[]};expect(list.projects.some(p=>p.name===project)).toBe(false);
});
it('project permissions intersect account roles and non-owners cannot manage members',async()=>{
 const owner=await account(),writer=await account(),reader=await account('reader'),project=name();await ensure(env,owner.actor,project);
 expect((await request(owner,`/v1/projects/${project}/members`,'POST',{username:writer.username,role:'reader'})).status).toBe(200);
 expect((await request(writer,`/v1/projects/${project}/members`)).status).toBe(403);
 await expect(access(env,writer.actor,project,'write')).rejects.toThrow('permission');
 await grant(env,owner.actor,project,new TextEncoder().encode(JSON.stringify({username:reader.username,role:'writer'})));
 await expect(access(env,reader.actor,project,'write')).rejects.toThrow('permission');
 expect((await request(reader,`/v1/stores/${project}/versions/${'a'.repeat(64)}/verify`,'POST')).status).toBe(403);
});
it('concurrent membership changes cannot remove the final owner or let a revoked creator rejoin',async()=>{
 const a=await account(),b=await account(),project=name();await ensure(env,a.actor,project);
 await expect(revoke(env,a.actor,project,a.username)).rejects.toThrow('last project owner');
 await grant(env,a.actor,project,new TextEncoder().encode(JSON.stringify({username:b.username,role:'owner'})));
 const changes=await Promise.allSettled([revoke(env,a.actor,project,a.username),revoke(env,b.actor,project,b.username)]);
 expect(changes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const rows=await env.DB.prepare("SELECT username FROM native_project_members WHERE project = ? AND role = 'owner'").bind(project).all<{username:string}>();expect(rows.results).toHaveLength(1);
 const revoked=rows.results[0]!.username===a.username?b:a;
 await expect(ensure(env,revoked.actor,project)).rejects.toThrow('project not found');
});
it('alternate artifact, generation and judgement URLs remain private',async()=>{
 const a=await account(),b=await account(),project=name(),hash='b'.repeat(64);await ensure(env,a.actor,project);
 await env.DB.prepare('INSERT INTO project_artifacts (project,hash) VALUES (?,?)').bind(project,hash).run();await env.ARTIFACTS.put(`artifacts/${hash}.wasm`,new Uint8Array([1,2,3]));
 expect((await request(b,`/v1/artifacts/${hash}`)).status).toBe(404);expect((await request(a,`/v1/artifacts/${hash}`)).status).toBe(200);
 for(const [kind,path]of [['generation','generations'],['judgement','judgements']] as const){await claim(env,a.actor,kind,hash,project);expect((await request(b,`/v1/${path}/${hash}/context`)).status).toBe(404);await expect(resource(env,b.actor,kind,hash)).rejects.toThrow('project not found');}
});
it('MCP and experiment status cannot bypass project membership',async()=>{
 const a=await account(),b=await account(),project=name(),experiment='EXP-'+crypto.randomUUID();await claim(env,a.actor,'experiment',experiment,project);
 await coordinate(env,experiment,'init',{experiment,project,planHash:'a'.repeat(64),count:2});
 expect((await request(b,`/v1/experiments/${experiment}`)).status).toBe(404);expect((await request(a,`/v1/experiments/${experiment}`)).status).toBe(200);
 const reply=await(await request(b,'/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ace_status',arguments:{experiment}}})).json() as {result:{isError:boolean}};expect(reply.result.isError).toBe(true);
});
it('resource ownership cannot be reassigned by another project and audit contains no credentials',async()=>{
 const a=await account(),b=await account(),p=name(),q=name(),id='a'.repeat(64);await claim(env,a.actor,'generation',id,p);
 await expect(claim(env,b.actor,'generation',id,q)).rejects.toThrow('different project');await resource(env,a.actor,'generation',id);
 const events=await(await request(a,`/v1/projects/${p}/audit`)).json();expect(JSON.stringify(events)).not.toContain(password);expect(JSON.stringify(events)).not.toContain(a.token);
 expect((await request(b,`/v1/projects/${p}/audit`)).status).toBe(404);
});
it('a simultaneous first upload grants exactly one project creator',async()=>{
 const a=await account(),b=await account(),project=name();const results=await Promise.allSettled([ensure(env,a.actor,project),ensure(env,b.actor,project)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM native_project_members WHERE project = ?').bind(project).first()).toMatchObject({n:1});
});

it('cached model outputs cannot be claimed from legacy or another private project',async()=>{
 const a=await account(),b=await account(),p=name(),q=name(),id='c'.repeat(64);
 await env.ARTIFACTS.put(`generations/${id}/manifest.json`,'private legacy output');
 await expect(reserveModel(env,a.actor,'generation',id,p)).rejects.toThrow('legacy resource');
 await claim(env,a.actor,'generation',id,p);
 await expect(reserveModel(env,b.actor,'generation',id,q)).rejects.toThrow('different project');
});
