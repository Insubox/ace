import { env, SELF, introspectWorkflowInstance } from 'cloudflare:test';
import { beforeAll, expect, it, vi } from 'vitest';
import migration from '../migrations/0001_control_plane.sql?raw';
import { type Env, type ExperimentState, type CloudPlan, type Task, type Job, coordinate, sha256, strictJson, immutablePut } from '../src/contracts';
import { consumeEvaluation, consumeFinalization } from '../src/pipeline';

const token = 'local-tests-only-0123456789abcdef0123456789abcdef';
const auth = { authorization: `Bearer ${token}` };
const emptyHash = '0'.repeat(64);
beforeAll(async () => { await env.DB.batch(migration.split(';').map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s))); });
function makePlan(count = 1): CloudPlan {
  const module = { id: 'C-base', module: 'gcd.wasm', strategy: 'euclid', generator: { provider: 'manual', model: 'reviewed', revision: null } };
  return { schema_version: 1, requested_experiment: 'EXP-label', config: { schema_version: 1, project: 'PRJ-test',
    experiment: `EXP-${crypto.randomUUID()}`, cell: 'Gcd', intent: 'INT-test', hypothesis: 'H-test', baseline: module,
    candidates: Array.from({ length: count }, (_, i) => ({ ...module, id: `C-${i}` })),
    harness: { entrypoint: 'gcd', public_cases: [[0, 0], [12, 8]], oracle_seed: 19, hidden_cases: 16, hidden_max_input: 1024,
      benchmark_samples: 3, benchmark_rounds: 2, fuel_per_call: 50000, memory_pages: 32 }, min_relative_improvement: 0.01, max_wall_clock_seconds: 60 },
    module_hashes: Array.from({ length: count + 1 }, () => emptyHash) };
}
async function register(p: CloudPlan): Promise<{ experiment: string; planHash: string }> {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const job = { experiment: p.config.experiment, planHash: await sha256(bytes) };
  await coordinate(env, job.experiment, 'init', { ...job, project: p.config.project, count: p.module_hashes.length });
  await immutablePut(env.ARTIFACTS, `experiments/${job.experiment}/plan.json`, bytes);
  await env.DB.prepare('INSERT INTO experiments(id, project, plan_hash, status, created_at) VALUES(?, ?, ?, ?, ?)').bind(job.experiment, 'PRJ-test', job.planHash, 'registered', Date.now()).run();
  return job;
}
it('fails closed before authentication, enforces upload hashes and size bounds', async () => {
  expect((await SELF.fetch('https://ace/v1/experiments')).status).toBe(401);
  const request = (body: Uint8Array) => SELF.fetch(`https://ace/v1/artifacts/${emptyHash}`, { method: 'PUT', headers: auth, body });
  expect((await request(new Uint8Array([1]))).status).toBe(400);
  expect((await request(new Uint8Array(1_048_577))).status).toBe(413);
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]); const h = await sha256(bytes);
  for (let i = 0; i < 2; i++) expect((await SELF.fetch(`https://ace/v1/artifacts/${h}`, { method: 'PUT', headers: auth, body: bytes })).status).toBe(201);
  expect([...new Uint8Array(await (await SELF.fetch(`https://ace/v1/artifacts/${h}`, { headers: auth })).arrayBuffer())]).toEqual([...bytes]);
});
it('rejects duplicate JSON keys and unsafe plan seeds', async () => {
  expect(() => strictJson('{"id":1,"\\u0069d":2}')).toThrow('duplicate');
  expect(() => strictJson('[1,]')).toThrow();
  const p = makePlan(); p.config.harness.oracle_seed = Number.MAX_SAFE_INTEGER + 1;
  const response = await SELF.fetch('https://ace/v1/experiments', { method: 'POST', headers: auth, body: JSON.stringify(p) });
  expect(response.status).toBe(400);
});
it('does not start an experiment with missing artifacts', async () => {
  const response = await SELF.fetch('https://ace/v1/experiments', { method: 'POST', headers: auth, body: JSON.stringify(makePlan()) });
  expect(response.status).toBe(409);
});
it('API registration is retryable and rejects changed plans under an existing identity', async () => {
  const p = makePlan(); const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]); const artifactHash = await sha256(bytes);
  p.module_hashes.fill(artifactHash);
  await SELF.fetch(`https://ace/v1/artifacts/${artifactHash}`, { method: 'PUT', headers: auth, body: bytes });
  await using instance = await introspectWorkflowInstance(env.EXPERIMENTS, p.config.experiment);
  const register = () => SELF.fetch('https://ace/v1/experiments', { method: 'POST', headers: auth, body: JSON.stringify(p) });
  expect((await register()).status).toBe(202); expect((await register()).status).toBe(202);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM experiments WHERE id = ?').bind(p.config.experiment).first<{n: number}>())!.n).toBe(1);
  p.config.harness.oracle_seed++;
  expect((await register()).status).toBe(409);
});
it('R2 immutability rejects replacement content under a previously stored key', async () => {
  const key = `test-${crypto.randomUUID()}`;
  await immutablePut(env.ARTIFACTS, key, new Uint8Array([1]));
  await expect(immutablePut(env.ARTIFACTS, key, new Uint8Array([2]))).rejects.toThrow('conflict');
});
it('coordinator leases are exclusive and completion is idempotent', async () => {
  const job = await register(makePlan());
  const first = await coordinate(env, job.experiment, 'claim', { ...job, index: 0 }) as { token: string };
  expect((await coordinate(env, job.experiment, 'claim', { ...job, index: 0 }) as { disposition: string }).disposition).toBe('busy');
  await expect(coordinate(env, job.experiment, 'complete', { ...job, index: 0, token: 'wrong' })).rejects.toThrow('lease');
  const complete = { ...job, index: 0, token: first.token, resultKey: 'observation', resultHash: emptyHash };
  await coordinate(env, job.experiment, 'complete', complete); await coordinate(env, job.experiment, 'complete', complete);
  const state = await coordinate(env, job.experiment, 'status') as ExperimentState;
  expect(state.completed).toBe(1);
  await expect(coordinate(env, job.experiment, 'claim', { ...job, index: 'final' })).rejects.toThrow('incomplete');
  await expect(coordinate(env, job.experiment, 'init', { ...job, planHash: '1'.repeat(64) })).rejects.toThrow('another plan');
  const view = await (await SELF.fetch(`https://ace/v1/experiments/${job.experiment}`, { headers: auth })).json() as Record<string, unknown>;
  expect(view.completed).toBe(1); expect(view.tasks).toBeUndefined();
});
it('released stale leases cannot commit, retry exhaustion never qualifies', async () => {
  const job = await register(makePlan());
  let old = '';
  for (let i = 0; i < 3; i++) {
    const claim = await coordinate(env, job.experiment, 'claim', { ...job, index: 0 }) as { token: string };
    if (old) await expect(coordinate(env, job.experiment, 'complete', { ...job, index: 0, token: old })).rejects.toThrow('lease');
    old = claim.token; await coordinate(env, job.experiment, 'release', { ...job, index: 0, token: claim.token });
  }
  expect((await coordinate(env, job.experiment, 'claim', { ...job, index: 0 }) as { disposition: string }).disposition).toBe('terminal');
  expect((await coordinate(env, job.experiment, 'status') as ExperimentState).status).toBe('failed');
});
it('serves stateless MCP tools with the same authorization and validation', async () => {
  const call = (method: string, params?: unknown) => SELF.fetch('https://ace/mcp', { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  expect((await (await call('initialize')).json() as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-03-26');
  expect((await (await call('tools/list')).json() as { result: { tools: unknown[] } }).result.tools).toHaveLength(4);
  expect((await (await call('tools/call', { name: 'ace_explain', arguments: { experiment: 'EXP-absent' } })).json() as { result: { isError: boolean } }).result.isError).toBe(true);
});
it('accepts 101 out-of-order queue observations once and indexes trusted results', async () => {
  const p = makePlan(100); const job = await register(p);
  const sandboxEvaluate = vi.fn(async (task: Job) => JSON.stringify({ content_hash: emptyHash,
    observation: { index: task.index, module_hash: emptyHash, plan_hash: emptyHash } }));
  const testEnv = { ...env, SANDBOXES: { getByName: () => ({ evaluate: sandboxEvaluate }) },
    EXPERIMENTS: { get: async () => ({ sendEvent: async () => {} }) } } as unknown as Env;
  for (let index = 100; index >= 0; index--) expect(await consumeEvaluation(testEnv, { ...job, index })).toBe('ack');
  expect(await consumeEvaluation(testEnv, { ...job, index: 17 })).toBe('ack');
  expect(sandboxEvaluate).toHaveBeenCalledTimes(101);
  const state = await coordinate(env, job.experiment, 'status') as ExperimentState;
  expect(state.completed).toBe(101);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluations WHERE experiment = ?').bind(job.experiment).first<{n: number}>())!.n).toBe(101);
  const finalize = vi.fn(async () => [{ path: 'run.json', content: JSON.stringify({ report: { results: [] } }) }]);
  const finalEnv = { ...testEnv, SANDBOXES: { getByName: () => ({ finalize }) } } as unknown as Env;
  expect(await consumeFinalization(finalEnv, job)).toBe('ack');
  expect(await consumeFinalization(finalEnv, job)).toBe('ack');
  expect(finalize).toHaveBeenCalledTimes(1);
  expect((await coordinate(env, job.experiment, 'status') as ExperimentState).status).toBe('completed');
});
it('a retry reuses committed observations and repairs metadata after a D1 failure', async () => {
  const job = await register(makePlan());
  const evaluate = vi.fn(async () => JSON.stringify({ content_hash: emptyHash, observation: { index: 0, module_hash: emptyHash, plan_hash: emptyHash } }));
  const notifyBinding = { get: async () => ({ sendEvent: async () => {} }) };
  const broken = { ...env, SANDBOXES: { getByName: () => ({ evaluate }) }, EXPERIMENTS: notifyBinding,
    DB: { prepare: () => { throw new Error('transient D1 failure'); } } } as unknown as Env;
  await expect(consumeEvaluation(broken, { ...job, index: 0 })).rejects.toThrow('D1');
  const repaired = { ...env, SANDBOXES: broken.SANDBOXES, EXPERIMENTS: notifyBinding } as unknown as Env;
  expect(await consumeEvaluation(repaired, { ...job, index: 0 })).toBe('ack');
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT candidate FROM evaluations WHERE experiment = ?').bind(job.experiment).first('candidate')).toBe('C-base');
});
it('runs the real Workflow dispatch and durable completion events', async () => {
  const job = await register(makePlan());
  await using instance = await introspectWorkflowInstance(env.EXPERIMENTS, job.experiment);
  await env.EXPERIMENTS.create({ id: job.experiment, params: job });
  // Workflow sees coordinator completion; a separate test covers queue evaluation.
  for (let index = 0; index < 2; index++) {
    const claim = await coordinate(env, job.experiment, 'claim', { ...job, index }) as { token: string };
    await coordinate(env, job.experiment, 'complete', { ...job, index, token: claim.token, resultKey: `key-${index}`, resultHash: emptyHash });
  }
  await (await env.EXPERIMENTS.get(job.experiment)).sendEvent({ type: 'evaluated', payload: {} });
  const claim = await coordinate(env, job.experiment, 'claim', { ...job, index: 'final' }) as { token: string };
  await coordinate(env, job.experiment, 'complete', { ...job, index: 'final', token: claim.token, resultKey: 'run.json', resultHash: emptyHash });
  await (await env.EXPERIMENTS.get(job.experiment)).sendEvent({ type: 'finalized', payload: {} });
  await instance.waitForStatus('complete');
  expect(await instance.getOutput()).toEqual({ experiment: job.experiment, report: 'run.json' });
});
