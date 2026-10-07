import { lstat,writeFile } from 'node:fs/promises';
import { boundedFile,api } from './client.mjs';
import { responseBytes } from './agent-driver.mjs';

export function accountOrigin(value){
  const url=new URL(value);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Choose an ACE HTTPS origin');
  return url.origin;
}
export async function loadSession(path){
  const file=await lstat(path);
  if(!file.isFile()||(process.platform!=='win32'&&(file.mode&0o077)))throw new Error('Session file must be a private regular file (chmod 600 on Unix)');
  const session=JSON.parse(await boundedFile(path,16384));
  const origin=accountOrigin(session.origin);
  if(session.schema_version!==1||!/^ace_session_[0-9a-f]{64}$/.test(session.token)||!Number.isSafeInteger(session.expires_at)||session.expires_at<=Date.now())throw new Error('ACE session expired or is invalid; sign in again');
  return{origin,token:session.token};
}
export async function loginSession({origin,username,password,output,request=fetch}){
  origin=accountOrigin(origin);
  const response=await request(origin+'/v1/auth/login',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
  if(!response.ok)throw new Error(response.status===429?'Sign-in attempt limit reached; try again later':'ACE sign-in failed');
  const session=JSON.parse(await responseBytes(response,16384));
  if(session.username!==username||!['admin','writer','reader'].includes(session.role)||!/^ace_session_[0-9a-f]{64}$/.test(session.token)||!Number.isSafeInteger(session.expires_at)||session.expires_at<=Date.now())throw new Error('Unexpected ACE session response');
  try{await writeFile(output,JSON.stringify({schema_version:1,origin,...session})+'\n',{flag:'wx',mode:0o600});}
  catch(error){try{await (await api({origin,token:session.token},'/v1/auth/logout',{method:'POST',signal:AbortSignal.timeout(30000)})).body?.cancel();}catch{/* Do not replace the original filesystem error. */}throw error;}
  return{username:session.username,role:session.role,expires_at:session.expires_at,session_file:output};
}
