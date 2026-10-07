import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rawHash } from '../client.mjs';
import { readJudgeRecord } from '../judge-records.mjs';

// Transport fixtures only: these are not live model responses or calibration.
async function fixture(t, stage = 'flash') {
  const root = await mkdtemp(join(tmpdir(), 'ace-judge-record-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, stage));
  const context = Buffer.from('{"candidate":"C-fixture"}');
  const request = Buffer.from('{"state":"public fixture"}');
  const inputHash = rawHash(context), requestHash = rawHash(request);
  const model = `@cf/cloudflare/${stage === 'flash' ? 'clef-flash' : 'clef'}`;
  const attempt = { schema_version: 1, input_hash: inputHash, fault: null,
    result: { input_hash: inputHash, request_hash: requestHash, model, stage: stage === 'flash' ? 'l1a' : 'l1b',
      adapter_version: 'clef-adapter-v2', question_schema_version: 'gcd-triage-v1' } };
  const documents = { context, request, response: Buffer.from('{"fixture":true}'), attempt: Buffer.from(JSON.stringify(attempt)) };
  const manifest = { judgement: rawHash(Buffer.from(`clef-adapter-v2/gcd-triage-v1/${stage}/${inputHash}`)),
    advisory_only: true, input_hash: inputHash, request_hash: requestHash, model, fault: null,
    adapter_version: 'clef-adapter-v2', question_schema_version: 'gcd-triage-v1', files: {} };
  async function save() {
    for (const [name, bytes] of Object.entries(documents)) {
      manifest.files[name] = rawHash(bytes); await writeFile(join(root, stage, `${name}.json`), bytes);
    }
    await writeFile(join(root, stage, 'manifest.json'), JSON.stringify(manifest));
  }
  await save(); return { root, context, attempt, manifest, documents, save };
}

test('complete retained records preserve exact public context and stage linkage', async t => {
  for (const stage of ['flash', 'clef']) {
    const f = await fixture(t, stage);
    const result = await readJudgeRecord(f.root, stage, f.context);
    assert.deepEqual(result.attempt, f.attempt);
    assert.equal(result.manifest.judgement, f.manifest.judgement);
  }
});
test('modified raw request or response bytes are rejected', async t => {
  for (const name of ['request', 'response']) {
    const f = await fixture(t);
    await writeFile(join(f.root, 'flash', `${name}.json`), '{}');
    await assert.rejects(readJudgeRecord(f.root, 'flash', f.context), /hash failed/);
  }
});
test('rehashing forged normalized metadata cannot change the declared model', async t => {
  const f = await fixture(t); f.attempt.result.model = '@cf/cloudflare/clef';
  f.documents.attempt = Buffer.from(JSON.stringify(f.attempt)); await f.save();
  await assert.rejects(readJudgeRecord(f.root, 'flash', f.context), /result linkage/);
});
test('different public input bytes and swapped stages cannot enter the cohort', async t => {
  const f = await fixture(t);
  await assert.rejects(readJudgeRecord(f.root, 'flash', Buffer.from('{}')), /identity/);
  f.manifest.model = '@cf/cloudflare/clef'; await f.save();
  await assert.rejects(readJudgeRecord(f.root, 'flash', f.context), /identity/);
});
test('success requires a retained raw response while explicit provider faults remain faults', async t => {
  const f = await fixture(t);
  delete f.documents.response; delete f.manifest.files.response; await f.save();
  await assert.rejects(readJudgeRecord(f.root, 'flash', f.context), /result linkage/);
  f.attempt.result = null; f.attempt.fault = 'unavailable'; f.manifest.fault = 'unavailable';
  f.documents.attempt = Buffer.from(JSON.stringify(f.attempt)); await f.save();
  assert.equal((await readJudgeRecord(f.root, 'flash', f.context)).attempt.fault, 'unavailable');
});
