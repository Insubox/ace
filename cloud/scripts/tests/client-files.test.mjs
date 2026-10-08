import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,mkdir} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {boundedFile} from '../client.mjs';
test('client uploads reject linked inputs, directories and FIFOs without reading their contents',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ace-upload-'));try{
  const target=join(root,'target');await writeFile(target,'valid');assert.equal((await boundedFile(target,5)).toString(),'valid');
  await symlink(target,join(root,'linked'));await assert.rejects(boundedFile(join(root,'linked'),5));
  await mkdir(join(root,'directory'));await assert.rejects(boundedFile(join(root,'directory'),5),/regular file/);
  execFileSync('mkfifo',[join(root,'fifo')]);await assert.rejects(boundedFile(join(root,'fifo'),5),/regular file/);
  await assert.rejects(boundedFile('/dev/zero',5),/regular file/);await assert.rejects(boundedFile(target,4),/upload limit/);
  await assert.rejects(boundedFile(target,-1),/byte budget/);assert.equal((await boundedFile(target,5)).toString(),'valid');
 }finally{await rm(root,{recursive:true,force:true});}
});
