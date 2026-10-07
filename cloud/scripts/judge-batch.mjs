import { mkdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { api, boundedFile, rawHash, settings } from './client.mjs';
import { readJudgeRecord } from './judge-records.mjs';

const [contexts, output] = process.argv.slice(2);
if (!contexts || !output) throw new Error('Usage: node cloud/scripts/judge-batch.mjs <frozen-context-directory> <output-directory>');
const config = settings();
const source = resolve(contexts), root = resolve(output);
const manifestBytes = await boundedFile(resolve(source, 'manifest.json'), 65536);
const manifest = JSON.parse(manifestBytes);
if (!Array.isArray(manifest.contexts) || manifest.contexts.length < 2 || manifest.contexts.length > 25
    || new Set(manifest.contexts.map(c => c.candidate)).size !== manifest.contexts.length)
  throw new Error('A frozen batch must contain 2–25 distinct candidates (at most 50 model requests)');
const inputs = [];
for (const entry of manifest.contexts) {
  if (!/^C-(reference|v[0-9]{2})$/.test(entry.candidate) || entry.file !== `${entry.candidate}.json`)
    throw new Error('Invalid frozen context identity');
  const bytes = await boundedFile(resolve(source, entry.file), 32768);
  const context = JSON.parse(bytes);
  if (rawHash(bytes) !== entry.input_hash || context.candidate !== entry.candidate || context.known_failures?.length !== 0)
    throw new Error('Public context changed or contains execution outcomes');
  inputs.push({ entry, bytes });
}
await mkdir(root, { recursive: true });
async function freeze(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (rawHash(await boundedFile(path, 65536)) !== rawHash(bytes)) throw new Error('Resume identity changed');
  }
}
await freeze(resolve(root, 'batch-manifest.json'), manifestBytes);
for (const { entry, bytes } of inputs) {
  const candidateRoot = resolve(root, entry.candidate);
  await mkdir(candidateRoot, { recursive: true });
  await freeze(resolve(candidateRoot, 'context.json'), bytes);
  for (const stage of ['flash', 'clef']) {
    const destination = resolve(candidateRoot, stage);
    try {
      await stat(destination);
      const { attempt } = await readJudgeRecord(candidateRoot, stage, bytes);
      console.log(JSON.stringify({ candidate: entry.candidate, stage, resumed: true, fault: attempt.fault }));
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // A server-retained attempt is cacheable. Resume never invents a local
    // response and never overwrites a complete local record.
    const response = await api(config, `/v1/judge/${stage}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes });
    const retained = await response.json();
    if (!/^[0-9a-f]{64}$/.test(retained.judgement) || retained.input_hash !== entry.input_hash || retained.advisory_only !== true)
      throw new Error('Unexpected retained model identity');
    const temporary = `${destination}.partial`;
    await rm(temporary, { recursive: true, force: true }); await mkdir(temporary);
    await writeFile(resolve(temporary, 'manifest.json'), JSON.stringify(retained, null, 2), { flag: 'wx' });
    for (const [name, expected] of Object.entries(retained.files ?? {})) {
      if (!['context', 'request', 'response', 'attempt'].includes(name)) throw new Error('Unexpected model document');
      const doc = new Uint8Array(await (await api(config, `/v1/judgements/${retained.judgement}/${name}`)).arrayBuffer());
      if (doc.length > 262144 || rawHash(doc) !== expected) throw new Error('Retained document failed integrity check');
      await writeFile(resolve(temporary, `${name}.json`), doc, { flag: 'wx' });
    }
    await rename(temporary, destination);
    const { attempt } = await readJudgeRecord(candidateRoot, stage, bytes);
    console.log(JSON.stringify({ candidate: entry.candidate, stage, resumed: false, fault: attempt.fault }));
  }
}
