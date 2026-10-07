import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { boundedFile, rawHash } from './client.mjs';

// Freeze public model inputs before execution. Never read run results, oracle
// cases, corpus families or intended outcomes into the provider's context.
const [prepared, buildFile, output] = process.argv.slice(2);
if (!prepared || !buildFile || !output)
  throw new Error('Usage: node cloud/scripts/judge-plan-contexts.mjs <prepared-plan-directory> <build-manifest.json> <fresh-directory>');
const planBytes = await boundedFile(resolve(prepared, 'plan.json'), 131072);
const plan = JSON.parse(planBytes);
const build = JSON.parse(await boundedFile(resolve(buildFile), 65536));
const corpusRoot = resolve(dirname(buildFile), '..');
const candidates = [plan.config.baseline, ...plan.config.candidates];
if (plan.config.cell !== 'Gcd' || candidates.length !== build.artifacts.length)
  throw new Error('Prepared plan and reviewed corpus differ');
const contexts = [];
for (const candidate of candidates) {
  const entry = build.artifacts.find(a => a.id === candidate.id);
  if (!entry || !/^src\/(reference|v[0-9]{2})\.rs$/.test(entry.source)) throw new Error('Unknown reviewed source');
  const source = await boundedFile(resolve(corpusRoot, entry.source), 8192);
  if (rawHash(source) !== entry.source_hash || !plan.module_hashes.includes(entry.artifact_hash))
    throw new Error('Source or compiled artifact changed');
  const artifact = await boundedFile(resolve(prepared, 'artifacts', `${entry.artifact_hash}.wasm`), 1048576);
  if (rawHash(artifact) !== entry.artifact_hash) throw new Error('Frozen WASM changed');
  // Check the identity-to-hash mapping, rather than just corpus membership.
  const index = candidates.findIndex(c => c.id === candidate.id);
  if (plan.module_hashes[index] !== entry.artifact_hash) throw new Error('Candidate artifact mapping changed');
  const context = { schema_version: 1, experiment: plan.config.experiment, candidate: candidate.id,
    artifact_hash: entry.artifact_hash,
    contract_summary: 'Import-free gcd(u32, u32) -> u32. Return the greatest common divisor; gcd(0, 0) = 0. No host imports or external state.',
    intent_summary: 'Reduce measured Wasmi fuel without changing the public GCD contract.',
    candidate_summary: new TextDecoder('utf-8', { fatal: true }).decode(source), high_impact: false, known_failures: [] };
  const bytes = JSON.stringify(context, null, 2);
  contexts.push({ candidate: candidate.id, split: entry.split, file: `${candidate.id}.json`, input_hash: rawHash(new TextEncoder().encode(bytes)), bytes });
}
const root = resolve(output); await mkdir(root);
for (const context of contexts) await writeFile(resolve(root, context.file), context.bytes, { flag: 'wx' });
await writeFile(resolve(root, 'manifest.json'), JSON.stringify({ schema_version: 1, frozen_at: new Date().toISOString(), plan_hash: rawHash(planBytes), corpus_manifest_hash: build.manifest_hash, contexts: contexts.map(({ bytes, ...c }) => c) }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ frozen_contexts: contexts.length, output: root }));
