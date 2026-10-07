import { env, SELF } from 'cloudflare:test';
import { beforeAll,expect,it } from 'vitest';
import migration from '../migrations/0004_native_accounts.sql?raw';
import storesMigration from '../migrations/0003_native_stores.sql?raw';
import { sha256, coordinate } from '../src/contracts';
const operator='local-tests-only-0123456789abcdef0123456789abcdef';
const password='native-account-test-password';
beforeAll(async()=>{for(const sql of[migration,storesMigration])await env.DB.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));});
const request=(path:string,method='GET',body?:unknown,token=operator)=>SELF.fetch('https://ace'+path,{method,headers:{authorization:'Bearer '+token,'CF-Connecting-IP':'test-'+crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
async function account(role:string){const username='user-'+crypto.randomUUID().slice(0,8);const created=await request('/v1/users','POST',{username,password,role});expect(created.status).toBe(201);const response=await request('/v1/auth/login','POST',{username,password},'');expect(response.status).toBe(200);const session=await response.json() as {token:string};return{username,token:session.token};}
it('first-administrator setup requires an operator-issued single-use ticket and rejects expiry or reuse',async()=>{
  await env.DB.prepare('DELETE FROM native_sessions').run();await env.DB.prepare('DELETE FROM native_users').run();
  expect((await request('/v1/auth/setup-ticket','POST',undefined,'not-authorized')).status).toBe(401);
  const expired='a'.repeat(64);await coordinate(env,'ACE-NATIVE-ACCOUNT-SETUP','setup-issue',{hash:await sha256(new TextEncoder().encode(expired)),expires:Date.now()-1});
  expect((await request('/v1/auth/setup','POST',{code:expired,username:'first-admin',password},'')).status).toBe(401);
  const response=await request('/v1/auth/setup-ticket','POST');expect(response.status).toBe(200);const ticket=await response.json() as {path:string};const code=new URL('https://ace'+ticket.path).hash.slice('#setup='.length);
  const payload={code,username:'first-admin',password};expect((await request('/v1/auth/setup','POST',payload,'')).status).toBe(201);
  expect((await request('/v1/auth/setup','POST',payload,'')).status).toBe(401);expect((await request('/v1/auth/setup-ticket','POST')).status).toBe(409);
  expect((await request('/v1/auth/login','POST',{username:'first-admin',password},'')).status).toBe(200);
  const page=await SELF.fetch('https://ace/setup');expect(page.status).toBe(200);expect(await page.text()).toContain('Create your ACE administrator account');
});
it('operator bootstrap creates a salted account without returning or storing plaintext credentials',async()=>{
  const a=await account('admin');const row=await env.DB.prepare('SELECT * FROM native_users WHERE username = ?').bind(a.username).first<Record<string,unknown>>();
  expect(row?.password_hash).toMatch(/^[0-9a-f]{64}$/);expect(row?.salt).toMatch(/^[0-9a-f]{32}$/);expect(JSON.stringify(row)).not.toContain(password);
  expect(await(await request('/v1/auth/me','GET',undefined,a.token)).json()).toEqual({username:a.username,role:'admin',kind:'account'});
  const session=await env.DB.prepare('SELECT token_hash FROM native_sessions WHERE username = ?').bind(a.username).first<{token_hash:string}>();expect(session?.token_hash).toBe(await sha256(new TextEncoder().encode(a.token)));
});
it('reader sessions can inspect history and sign out but cannot upload or create accounts',async()=>{
  const a=await account('reader');expect((await request('/v1/stores','GET',undefined,a.token)).status).toBe(200);
  expect((await request('/v1/stores/test/objects/'+'0'.repeat(64),'PUT','code',a.token)).status).toBe(403);
  expect((await request('/v1/users','POST',{username:'another',password,role:'admin'},a.token)).status).toBe(403);
  expect((await request('/v1/stores/private/versions/'+'a'.repeat(64)+'/verify','POST',undefined,a.token)).status).toBe(403);
  expect((await request('/v1/auth/logout','POST',undefined,a.token)).status).toBe(200);expect((await request('/v1/auth/me','GET',undefined,a.token)).status).toBe(401);
});
it('writers cannot administer users and administrators can create bounded roles',async()=>{
  const writer=await account('writer');expect((await request('/v1/users','GET',undefined,writer.token)).status).toBe(403);
  const admin=await account('admin');expect((await request('/v1/users','GET',undefined,admin.token)).status).toBe(200);
  expect((await request('/v1/users','POST',{username:'invalid-role',password,role:'owner-of-everything'},admin.token)).status).toBe(400);
  expect((await request('/v1/users','POST',{username:admin.username,password:'different-test-password',role:'reader'},admin.token)).status).toBe(409);
});
it('invalid and nonexistent credentials fail equally and expired sessions do not authorize',async()=>{
  const a=await account('writer');for(const username of[a.username,'missing-'+crypto.randomUUID().slice(0,8)]){const response=await request('/v1/auth/login','POST',{username,password:'wrong-password-value'},'');expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'invalid username or password'});}
  await env.DB.prepare('UPDATE native_sessions SET expires_at = 0 WHERE username = ?').bind(a.username).run();expect((await request('/v1/auth/me','GET',undefined,a.token)).status).toBe(401);
});
it('limits repeated login attempts without spending generator or evaluator budgets',async()=>{
  const username='limited-'+crypto.randomUUID().slice(0,8);let response:Response|undefined;
  for(let i=0;i<21;i++)response=await request('/v1/auth/login','POST',{username,password},'');expect(response?.status).toBe(429);
  expect((await request('/v1/auth/me')).status).toBe(200);
});

it('administrator recovery replaces the password, revokes every session and keeps credentials out of audit',async()=>{
 const a=await account('writer'),admin=await account('admin'),newPassword='new-account-recovery-password';
 const login=await request('/v1/auth/login','POST',{username:a.username,password},'');const second=await login.json() as {token:string};
 expect((await request(`/v1/users/${a.username}/recovery`,'POST',undefined,a.token)).status).toBe(403);
 const ticket=await(await request(`/v1/users/${a.username}/recovery`,'POST',undefined,admin.token)).json() as {path:string};const code=new URLSearchParams(new URL('https://ace'+ticket.path).hash.slice(1)).get('recover');
 const input={username:a.username,code,password:newPassword};
 expect((await request('/v1/auth/recover','POST',input,'')).status).toBe(200);
 for(const token of[a.token,second.token])expect((await request('/v1/auth/me','GET',undefined,token)).status).toBe(401);
 expect((await request('/v1/auth/login','POST',{username:a.username,password},'')).status).toBe(401);
 expect((await request('/v1/auth/login','POST',{username:a.username,password:newPassword},'')).status).toBe(200);
 expect((await request('/v1/auth/recover','POST',input,'')).status).toBe(401);
 const audit=await(await request('/v1/auth/audit','GET',undefined,admin.token)).text();expect(audit).toContain('recovery.complete');for(const secret of[password,newPassword,code!,a.token])expect(audit).not.toContain(secret);
 expect((await request('/v1/auth/audit','GET',undefined,a.token)).status).toBe(401);
});
it('recovery invalidates replaced links and atomically admits only one concurrent redemption',async()=>{
 const a=await account('writer');const issue=async()=>{const data=await(await request(`/v1/users/${a.username}/recovery`,'POST')).json() as {path:string};return new URLSearchParams(new URL('https://ace'+data.path).hash.slice(1)).get('recover');};
 const old=await issue(),code=await issue();const input={username:a.username,password:'new-private-password',code};
 expect((await request('/v1/auth/recover','POST',{...input,code:old},'')).status).toBe(401);
 expect((await request('/v1/auth/recover','POST',{...input,username:'wrong-account'},'')).status).toBe(401);
 const results=await Promise.all([request('/v1/auth/recover','POST',input,''),request('/v1/auth/recover','POST',input,'')]);expect(results.map(r=>r.status).sort()).toEqual([200,401]);
 const expired=await issue();await env.DB.prepare('UPDATE native_recovery_tickets SET expires_at = 0 WHERE username = ?').bind(a.username).run();expect((await request('/v1/auth/recover','POST',{...input,code:expired},'')).status).toBe(401);
 expect((await SELF.fetch('https://ace/recover')).status).toBe(200);
});
