import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerAttempt, responseBytes, drive, MODEL_NAMES } from '../agent-driver.mjs';
import { rawHash } from '../client.mjs';

import { fixtureTask, transport } from './agent-fixtures.mjs';

test('retained generation is bound to the exact task, model and every raw document', async()=> {
  const root=await mkdtemp(join(tmpdir(),'ace-provider-'));
  try {
    const task=fixtureTask(), fake=transport(task), directory=join(root,'provider');
    const result=await providerAttempt({origin:'https://example.invalid',token:'not-a-real-token'},task,'qwen',directory,fake.request);
    assert.equal(result.receipt.input_hash,rawHash(fake.documents.context));
    assert.equal(result.attempt.result.candidates[0].wat,'(module)'); // Still requires actual ACE evaluation.
    assert.deepEqual(await readFile(join(directory,'response.json')),fake.documents.response);
    await providerAttempt({},task,'qwen',directory,fake.request); // Identical saved bytes are reused, never overwritten.
    assert(fake.paths.every(p=>p.startsWith('/v1/generate/')||p.startsWith('/v1/generations/')));
  } finally {await rm(root,{recursive:true,force:true});}
});
test('a different model or context is rejected before requesting retained source', async()=> {
  const root=await mkdtemp(join(tmpdir(),'ace-provider-'));
  try {
    for (const field of ['model','context_hash']) {
      const task=fixtureTask(),fake=transport(task);fake.manifest[field]=field==='model'?MODEL_NAMES.llama:'9'.repeat(64);
      await assert.rejects(providerAttempt({},task,'qwen',join(root,field),fake.request),/bound/);
      assert.equal(fake.paths.length,1);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
test('unexpected document names and changed response bytes cannot enter a saved invocation', async()=> {
  const root=await mkdtemp(join(tmpdir(),'ace-provider-'));
  try {
    const task=fixtureTask(),bad=transport(task);bad.manifest.files['../../outside']='0'.repeat(64);
    await assert.rejects(providerAttempt({},task,'qwen',join(root,'bad-path'),bad.request),/bound/);
    const changed=transport(task); changed.documents.response=Buffer.from('changed');
    await assert.rejects(providerAttempt({},task,'qwen',join(root,'changed'),changed.request),/changed/);
    await assert.rejects(access(join(root,'changed')));
  } finally {await rm(root,{recursive:true,force:true});}
});
test('streamed response limits are enforced before retaining an unbounded body', async()=> {
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(100));c.enqueue(new Uint8Array(100));c.close();}}));
  await assert.rejects(responseBytes(response,150),/byte limit/);
});
test('resume refuses a different origin or budget without exposing saved context', async()=> {
  const root=await mkdtemp(join(tmpdir(),'ace-driver-'));
  try {
    await writeFile(join(root,'driver.json'),JSON.stringify({schema_version:1,adapter_version:'wat-generator-v4',storage:'ace-native-v1',api_origin:'https://original.invalid',models:['qwen','llama'],rounds:4,candidates:2,attempts:3,patience:2,jobs:2}));
    let invoked=false;
    await assert.rejects(drive({directory:root,resume:true,config:{origin:'https://different.invalid'},command:()=>{invoked=true;}}),/Resume settings/);
    assert.equal(invoked,false);
  } finally {await rm(root,{recursive:true,force:true});}
});
