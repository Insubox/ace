// Native ACE workspace accounts. Passwords and session tokens never enter logs.
import { z } from 'zod';
import { type Env, HttpError, sha256, coordinate, strictJson, json } from './contracts';
const bytes=(s:string)=>new TextEncoder().encode(s);
const userName=z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/);
const password=z.string().refine(s=>bytes(s).length>=12&&bytes(s).length<=256);
const role=z.enum(['admin','writer','reader']);
const credentials=z.strictObject({username:userName,password});
type User={username:string;role:z.infer<typeof role>;salt:string;password_hash:string};
export type Identity={username:string;role:z.infer<typeof role>;kind:'operator'|'account'};
const random=(n:number)=>[...crypto.getRandomValues(new Uint8Array(n))].map(b=>b.toString(16).padStart(2,'0')).join('');
const equal=(a:string,b:string)=>{let different=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)different|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return different===0;};
async function derive(value:string,salt:string){
  const key=await crypto.subtle.importKey('raw',bytes(value),{name:'PBKDF2'},false,['deriveBits']);
  const buffer=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:100000,hash:'SHA-256'},key,256);
  return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function identity(request:Request,env:Env):Promise<Identity>{
  if(!env.API_TOKEN||env.API_TOKEN.length<32)throw new HttpError(503,'API authentication is not configured');
  const provided=request.headers.get('authorization')??'';
  const [actual,expected]=await Promise.all([sha256(bytes(provided)),sha256(bytes(`Bearer ${env.API_TOKEN}`))]);
  if(equal(actual,expected))return{username:'operator',role:'admin',kind:'operator'};
  if(!/^Bearer ace_session_[0-9a-f]{64}$/.test(provided))throw new HttpError(401,'unauthorized');
  const token=provided.slice(7),digest=await sha256(bytes(token));
  const account=await env.DB.prepare('SELECT u.username, u.role FROM native_sessions s JOIN native_users u ON u.username = s.username WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(digest,Date.now()).first<{username:string;role:Identity['role']}>();
  if(!account)throw new HttpError(401,'unauthorized');return{...account,kind:'account'};
}
export function authorize(request:Request,current:Identity){
  const path=new URL(request.url).pathname;
  if(current.role==='reader'&&!['GET','HEAD'].includes(request.method)&&path!=='/mcp'&&path!=='/v1/auth/logout')throw new HttpError(403,'read-only workspace account');
}
export async function createUser(env:Env,current:Identity,input:Uint8Array){
  if(current.role!=='admin')throw new HttpError(403,'administrator account required');
  const args=z.strictObject({username:userName,password,role}).parse(strictJson(new TextDecoder().decode(input)));
  const salt=random(16),digest=await derive(args.password,salt);
  const result=await env.DB.prepare('INSERT INTO native_users (username, role, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING')
    .bind(args.username,args.role,salt,digest,Date.now()).run();
  if(result.meta.changes!==1)throw new HttpError(409,'username already exists');
  return json({username:args.username,role:args.role,created:true},201);
}
export async function login(request:Request,env:Env,input:Uint8Array){
  const args=credentials.parse(strictJson(new TextDecoder().decode(input)));
  // Separate from evaluator/model reservations. Both identity and IP are bounded.
  const ip=request.headers.get('CF-Connecting-IP')??'local';
  for(const scope of[`user/${args.username}`,`ip/${ip}`]){
    const result=await coordinate(env,`ACE-AUTH-${await sha256(bytes(scope))}`,'auth-attempt',{}) as {allowed:boolean};
    if(!result.allowed)throw new HttpError(429,'login attempt limit reached; try again later');
  }
  const user=await env.DB.prepare('SELECT username, role, salt, password_hash FROM native_users WHERE username = ?').bind(args.username).first<User>();
  const digest=await derive(args.password,user?.salt??'0'.repeat(32));
  if(!user||!equal(digest,user.password_hash))throw new HttpError(401,'invalid username or password');
  const token='ace_session_'+random(32),expires=Date.now()+12*60*60*1000;
  await env.DB.prepare('DELETE FROM native_sessions WHERE expires_at <= ?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO native_sessions (token_hash, username, expires_at) VALUES (?, ?, ?)').bind(await sha256(bytes(token)),user.username,expires).run();
  return json({token,expires_at:expires,username:user.username,role:user.role});
}
export async function logout(request:Request,env:Env,current:Identity){
  if(current.kind==='account'){const token=request.headers.get('authorization')!.slice(7);await env.DB.prepare('DELETE FROM native_sessions WHERE token_hash = ?').bind(await sha256(bytes(token))).run();}
  return json({signed_out:true});
}
export async function users(env:Env,current:Identity){
  if(current.role!=='admin')throw new HttpError(403,'administrator account required');
  const result=await env.DB.prepare('SELECT username, role, created_at FROM native_users ORDER BY created_at LIMIT 100').all();return json({users:result.results});
}

export async function setupTicket(env:Env,current:Identity){
  if(current.kind!=='operator'||current.role!=='admin')throw new HttpError(403,'operator setup authorization required');
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM native_users').first<{n:number}>();
  if(count?.n)throw new HttpError(409,'workspace already has accounts; use administrator sign-in');
  const code=random(32),expires=Date.now()+600000;
  await coordinate(env,'ACE-NATIVE-ACCOUNT-SETUP','setup-issue',{hash:await sha256(bytes(code)),expires});
  return json({path:`/setup#setup=${code}`,expires_at:expires,purpose:'create_first_administrator'});
}
export async function setup(env:Env,input:Uint8Array){
  const args=z.strictObject({code:z.string().regex(/^[0-9a-f]{64}$/),username:userName,password}).parse(strictJson(new TextDecoder().decode(input)));
  await coordinate(env,'ACE-NATIVE-ACCOUNT-SETUP','setup-claim',{hash:await sha256(bytes(args.code))});
  const salt=random(16),digest=await derive(args.password,salt);
  // Atomic first-account condition also rejects a concurrent operator creation.
  const result=await env.DB.prepare('INSERT INTO native_users (username, role, salt, password_hash, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM native_users) ON CONFLICT(username) DO NOTHING')
    .bind(args.username,'admin',salt,digest,Date.now()).run();
  if(result.meta.changes!==1)throw new HttpError(409,'workspace already has an account; sign in');
  return json({created:true,username:args.username,role:'admin'},201);
}
