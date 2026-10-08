import {it,expect} from 'vitest';
import {env,SELF} from 'cloudflare:test';
const operator='local-tests-only-0123456789abcdef0123456789abcdef';
const password='private-browser-session-password';
async function account(){const username='browser-'+crypto.randomUUID().slice(0,8);expect((await SELF.fetch('https://ace/v1/users',{method:'POST',headers:{authorization:'Bearer '+operator},body:JSON.stringify({username,password,role:'writer'})})).status).toBe(201);return username;}
const login=(username:string,origin='https://ace')=>SELF.fetch('https://ace/v1/auth/browser-login',{method:'POST',headers:{origin,'CF-Connecting-IP':crypto.randomUUID()},body:JSON.stringify({username,password})});
it('uses an opaque host-only HttpOnly Secure cookie and keeps the token out of browser response JSON',async()=>{
 const username=await account(),response=await login(username);expect(response.status).toBe(200);const body=await response.json();expect(body).not.toHaveProperty('token');expect(body).toMatchObject({username,role:'writer'});
 const header=response.headers.get('set-cookie')!;expect(header).toMatch(/^__Host-ace_session=ace_session_[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);expect(header).not.toContain('Domain=');
 const cookie=header.split(';')[0]!;const authenticated=await SELF.fetch('https://ace/v1/auth/me',{headers:{cookie}});expect(await authenticated.json()).toMatchObject({username,kind:'account'});
 const rows=await env.DB.prepare('SELECT token_hash FROM native_sessions WHERE username=?').bind(username).all<{token_hash:string}>();expect(rows.results[0]!.token_hash).not.toContain(cookie.slice(cookie.indexOf('=')+1));
});
it('requires exact Origin for browser login and every cookie-authorized mutation, without changing bearer APIs',async()=>{
 const username=await account();expect((await login(username,'https://evil.example')).status).toBe(403);expect((await login(username,'')).status).toBe(403);
 const cookie=(await login(username)).headers.get('set-cookie')!.split(';')[0]!;
 for(const origin of ['https://evil.example','null',''])expect((await SELF.fetch('https://ace/v1/projects',{method:'POST',headers:{cookie,origin},body:JSON.stringify({name:'forbidden-'+crypto.randomUUID()})})).status).toBe(403);
 expect((await SELF.fetch('https://ace/v1/projects',{method:'POST',headers:{cookie,origin:'https://ace'},body:JSON.stringify({name:'allowed-'+crypto.randomUUID()})})).status).toBe(201);
 expect((await SELF.fetch('https://ace/v1/auth/me',{headers:{cookie,authorization:'Bearer invalid'}})).status).toBe(401);
});
it('revokes the server session on logout, expires its cookie and also clears an already-expired session',async()=>{
 const username=await account(),cookie=(await login(username)).headers.get('set-cookie')!.split(';')[0]!;
 expect((await SELF.fetch('https://ace/v1/auth/browser-logout',{method:'POST',headers:{cookie,origin:'https://evil.example'}})).status).toBe(403);
 const response=await SELF.fetch('https://ace/v1/auth/browser-logout',{method:'POST',headers:{cookie,origin:'https://ace'}});expect(response.status).toBe(200);expect(response.headers.get('set-cookie')).toContain('Max-Age=0');expect((await SELF.fetch('https://ace/v1/auth/me',{headers:{cookie}})).status).toBe(401);
 const expired=(await login(username)).headers.get('set-cookie')!.split(';')[0]!;await env.DB.prepare('UPDATE native_sessions SET expires_at=0 WHERE username=?').bind(username).run();expect((await SELF.fetch('https://ace/v1/auth/browser-logout',{method:'POST',headers:{cookie:expired,origin:'https://ace'}})).status).toBe(200);
});
it('rejects ambiguous duplicate cookies and limits insecure cookies to loopback development',async()=>{
 const username=await account(),cookie=(await login(username)).headers.get('set-cookie')!.split(';')[0]!;expect((await SELF.fetch('https://ace/v1/auth/me',{headers:{cookie:cookie+'; '+cookie}})).status).toBe(401);
 const input=JSON.stringify({username,password});expect((await SELF.fetch('http://ace/v1/auth/browser-login',{method:'POST',headers:{origin:'http://ace'},body:input})).status).toBe(400);
 const local=await SELF.fetch('http://127.0.0.1/v1/auth/browser-login',{method:'POST',headers:{origin:'http://127.0.0.1','CF-Connecting-IP':crypto.randomUUID()},body:input});expect(local.status).toBe(200);expect(local.headers.get('set-cookie')).toMatch(/^ace_session_local=/);expect(local.headers.get('set-cookie')).toContain('HttpOnly');
});
