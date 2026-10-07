import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { api, boundedFile, rawHash, settings } from './client.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run cloud:submit -- <ace-cloud-prepare-directory>');
const config = settings();
const root = await realpath(resolve(directory));
const planBytes = await boundedFile(resolve(root, 'plan.json'), 131_072);
const plan = JSON.parse(planBytes);
if (!Array.isArray(plan.module_hashes) || plan.module_hashes.length > 101) throw new Error('Invalid prepared plan');
for (const hash of new Set(plan.module_hashes)) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid artifact hash');
  const path = await realpath(resolve(root, 'artifacts', `${hash}.wasm`));
  if (!path.startsWith(root + sep)) throw new Error('Artifact path escapes prepared directory');
  const bytes = await boundedFile(path, 1_048_576);
  if (rawHash(bytes) !== hash) throw new Error('Prepared artifact changed');
  await api(config, `/v1/artifacts/${hash}`, { method: 'PUT', body: bytes });
}
const response = await api(config, '/v1/experiments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: planBytes });
console.log(JSON.stringify(await response.json(), null, 2));
