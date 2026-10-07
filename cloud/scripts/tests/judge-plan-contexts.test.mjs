import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rawHash } from '../client.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'ace-public-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['corpus/src', 'corpus/.ace-build', 'plan/artifacts']) await mkdir(resolve(root, dir), { recursive: true });
  const artifacts = [];
  for (const name of ['reference', 'v01']) {
    const source = Buffer.from(`pub fn ${name}() {}`);
    const module = Buffer.from(`transport fixture ${name}`);
    const artifact_hash = rawHash(module);
    await writeFile(resolve(root, `corpus/src/${name}.rs`), source);
    await writeFile(resolve(root, `plan/artifacts/${artifact_hash}.wasm`), module);
    artifacts.push({ id: `C-${name}`, source: `src/${name}.rs`, source_hash: rawHash(source), artifact_hash,
      split: name === 'reference' ? 'reference' : 'holdout', family: 'PRIVATE-FAMILY' });
  }
  const plan = { config: { experiment: 'EXP-fixture', cell: 'Gcd', baseline: { id: 'C-reference' }, candidates: [{ id: 'C-v01' }],
    harness: { oracle_seed: 'PRIVATE-ORACLE-SEED', public_cases: ['PRIVATE-CASES'] } }, module_hashes: artifacts.map(a => a.artifact_hash) };
  const build = { manifest_hash: 'fixture', artifacts };
  async function save() {
    await writeFile(resolve(root, 'plan/plan.json'), JSON.stringify(plan));
    await writeFile(resolve(root, 'corpus/.ace-build/build-manifest.json'), JSON.stringify(build));
  }
  await save();
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../judge-plan-contexts.mjs', import.meta.url)), resolve(root, 'plan'), resolve(root, 'corpus/.ace-build/build-manifest.json'), resolve(root, 'contexts')], { encoding: 'utf8' });
  return { root, plan, build, run, save };
}

test('frozen contexts expose source and public contract without harness or corpus metadata', async t => {
  const f = await fixture(t); const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const context = JSON.parse(await readFile(resolve(f.root, 'contexts/C-v01.json'), 'utf8'));
  assert.deepEqual(Object.keys(context).sort(), ['schema_version', 'experiment', 'candidate', 'artifact_hash', 'contract_summary', 'intent_summary', 'candidate_summary', 'high_impact', 'known_failures'].sort());
  assert.equal(context.candidate_summary, 'pub fn v01() {}'); assert.deepEqual(context.known_failures, []);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE|holdout|family|oracle_seed/);
});
test('changed public source is rejected before freezing model inputs', async t => {
  const f = await fixture(t); await writeFile(resolve(f.root, 'corpus/src/v01.rs'), 'substituted source');
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Source or compiled artifact changed/);
});
test('swapped artifact-to-candidate mappings cannot be hidden by corpus membership', async t => {
  const f = await fixture(t); f.plan.module_hashes.reverse(); await f.save();
  const result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Candidate artifact mapping changed/);
});
