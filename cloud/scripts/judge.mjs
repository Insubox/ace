import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { api, boundedFile, rawHash, settings } from './client.mjs';

const [contextFile, output] = process.argv.slice(2);
if (!contextFile || !output) throw new Error('Usage: node cloud/scripts/judge.mjs <public-context.json> <fresh-output-directory>');
const config = settings();
const contextBytes = await boundedFile(resolve(contextFile), 32768);
const root = resolve(output);
await mkdir(root);
await writeFile(resolve(root, 'context.json'), contextBytes, { flag: 'wx' });
const routes = [];
for (const selector of ['flash', 'clef']) {
  const response = await api(config, `/v1/judge/${selector}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: contextBytes });
  const manifest = await response.json();
  if (!/^[0-9a-f]{64}$/.test(manifest.judgement) || manifest.input_hash !== rawHash(contextBytes)
      || manifest.advisory_only !== true || !manifest.files?.attempt) throw new Error('Unexpected judge identity');
  const directory = resolve(root, selector); await mkdir(directory);
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!['context', 'request', 'response', 'attempt'].includes(name)) throw new Error('Unexpected judge document');
    const bytes = new Uint8Array(await (await api(config, `/v1/judgements/${manifest.judgement}/${name}`)).arrayBuffer());
    if (bytes.length > 262144 || rawHash(bytes) !== expected) throw new Error('Judge document corrupted or oversized');
    await writeFile(resolve(directory, `${name}.json`), bytes, { flag: 'wx' });
  }
  const routing = JSON.parse(execFileSync('ace', ['judge', 'route', resolve(root, 'context.json'), resolve(directory, 'attempt.json')], { encoding: 'utf8' }));
  routes.push({ model: manifest.model, judgement: manifest.judgement, decision: routing });
  await writeFile(resolve(directory, 'routing.json'), JSON.stringify(routing, null, 2), { flag: 'wx' });
  if (routing.route !== 'escalate') break;
}
const result = { schema_version: 1, advisory_only: true, real_execution_required: true, routes };
await writeFile(resolve(root, 'judgement.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
