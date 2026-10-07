// Exercise real local ACE with fixture transport; this makes no paid model calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { drive } from '../cloud/scripts/agent-driver.mjs';
import { transport } from '../cloud/scripts/tests/agent-fixtures.mjs';

const binary = resolve(process.argv[2] ?? 'target/debug/ace');
const fixture = JSON.parse(await readFile(new URL('../examples/agent-proposals/proposals.json', import.meta.url)));
const root = await mkdtemp(join(tmpdir(), 'ace-driver-integration-'));
let calls = 0, active;
const request = async (config, path, options = {}) => {
  if (path.startsWith('/v1/generate/')) {
    const task = JSON.parse(options.body);
    const selector = path.split('/').at(-1);
    const proposals = calls++ === 0
      ? [{ id:'C-invalid', wat:'(module (func (br $missing)))', strategy:'invalid-label-fixture' }]
      : [fixture.candidates[task.context.round === 1 ? 0 : 1]];
    active = transport(task, selector, proposals.map(({ id, wat, strategy }) => ({ id, wat, strategy })));
  }
  assert(active);
  return active.request(config, path, options);
};
try {
  const config = { origin:'https://fixture.invalid', token:'fixture-only' };
  const options = { directory:join(root,'campaign'), config, binary, rounds:2, candidates:1, attempts:2, patience:2, request };
  const result = await drive(options);
  assert.equal(calls, 3);
  assert.equal(result.completed_rounds, 2);
  assert.equal(result.stop_reason, 'round_budget');
  assert.equal(result.winner.mean_fuel, '23.5');
  assert.equal(result.winner.wat, fixture.candidates[0].wat);
  const history = JSON.parse(execFileSync(binary, ['store','log',join(root,'campaign/history')], {encoding:'utf8'}));
  assert.equal(history.snapshots.length, 3);
  assert.equal(history.generator_faults.length, 1);
  assert.equal(history.generator_faults[0].candidate_evaluation_performed, false);
  assert.deepEqual(await drive({...options, resume:true, request:()=>{throw new Error('completed campaign requested another paid generation');}}),result);
  console.log(JSON.stringify({real_native_evaluations:2, fixture_transport:true, paid_model_calls:0,
    invalid_wat_recovered:true, native_versions:4, generator_faults:1, completed_resume_verified:true}));
} finally { await rm(root,{recursive:true,force:true}); }
