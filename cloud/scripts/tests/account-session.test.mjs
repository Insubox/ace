import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,readFile,writeFile,rm,symlink,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loginSession,loadSession } from '../account-session.mjs';

test('account login retains only a private expiring session and refuses unsafe or expired files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ace-session-')),path=join(root,'session.json');
  const session={token:'ace_session_'+'a'.repeat(64),username:'fixture-user',role:'writer',expires_at:Date.now()+600000};
  const request=async(url,options)=>{assert.equal(url,'https://ace.example/v1/auth/login');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).password,'fixture-password-only');return Response.json(session);};
  try{
    const result=await loginSession({origin:'https://ace.example',username:'fixture-user',password:'fixture-password-only',output:path,request});
    assert(!JSON.stringify(result).includes(session.token));assert(!String(await readFile(path)).includes('fixture-password-only'));
    assert.deepEqual(await loadSession(path),{origin:'https://ace.example',token:session.token});
    if(process.platform!=='win32'){
      const link=join(root,'link');await symlink(path,link);await assert.rejects(loadSession(link),/private regular file/);
      await chmod(path,0o644);await assert.rejects(loadSession(path),/private regular file/);await chmod(path,0o600);
    }
    await writeFile(path,JSON.stringify({schema_version:1,origin:'https://ace.example',...session,expires_at:0}));await assert.rejects(loadSession(path),/expired/);
    await assert.rejects(loginSession({origin:'https://attacker.example/path',username:'fixture-user',password:'fixture-password-only',output:path,request}),/HTTPS origin/);
    await assert.rejects(loginSession({origin:'https://ace.example',username:'fixture-user',password:'fixture-password-only',output:path,request:async()=>Response.json({error:'invalid'}, {status:401})}),/sign-in failed/);
  }finally{await rm(root,{recursive:true,force:true});}
});
