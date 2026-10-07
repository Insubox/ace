import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { api, rawHash, settings } from './client.mjs';

const [experiment, directory] = process.argv.slice(2);
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
if (!experiment || !id.test(experiment) || !directory) throw new Error('Usage: node cloud/scripts/download.mjs <experiment-id> <fresh-output-directory>');
const config = settings(); const root = resolve(directory);
const manifestBytes = new Uint8Array(await (await api(config, `/v1/experiments/${experiment}/files/run.json`)).arrayBuffer());
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); const report = manifest.report;
if (report.experiment.id !== experiment || !Array.isArray(report.results) || report.results.length < 2 || report.results.length > 101) throw new Error('Unexpected run identity or population');
const files = ['environment.json', 'intent.json', 'experiment.json', 'knowledge.json'];
if (report.champion) files.push('champion.json'); if (report.baseline_champion) files.push('baseline-champion.json');
const hashes = new Set();
for (const result of report.results) {
  const candidate = result.candidate.id; const hash = result.candidate.patch.hash;
  if (!id.test(candidate) || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid run artifact identity');
  hashes.add(hash);
  for (const name of ['candidate', 'evaluation', 'evidence', 'decision']) files.push(`candidates/${candidate}/${name}.json`);
}
await mkdir(root); // Exclusive: never replace an existing run.
await mkdir(resolve(root, 'artifacts'));
for (const path of files) {
  const bytes = new Uint8Array(await (await api(config, `/v1/experiments/${experiment}/files/${path}`)).arrayBuffer());
  const file = resolve(root, path); await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, bytes, { flag: 'wx' });
}
for (const hash of hashes) {
  const bytes = new Uint8Array(await (await api(config, `/v1/artifacts/${hash}`)).arrayBuffer());
  if (rawHash(bytes) !== hash) throw new Error('Downloaded module corrupted');
  await writeFile(resolve(root, 'artifacts', `${hash}.wasm`), bytes, { flag: 'wx' });
  if (report.champion?.artifact.hash === hash) await writeFile(resolve(root, 'champion.wasm'), bytes, { flag: 'wx' });
}
await writeFile(resolve(root, 'run.json'), manifestBytes, { flag: 'wx' });
// Uses Rust to check seals, provenance, artifacts and reproduce every policy gate.
execFileSync('ace', ['status', root], { stdio: 'inherit' });
