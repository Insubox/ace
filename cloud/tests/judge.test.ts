import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { type Env, type CloudPlan, coordinate, immutablePut, sha256 } from '../src/contracts';
import { judge, normalizeClef, readJudgement, type JudgeContext } from '../src/judge';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hash = '0'.repeat(64);
function response(model = 'clef-flash') {
  return { model, answers: {
    behavior_change_risk: { type: 'noul', noul: 0.25 },
    prior_failure_similarity: { type: 'noul', noul: 0.1 },
    architectural_fit: { type: 'choice', choice: 'good', probabilities: { good: 0.8, uncertain: 0.1, poor: 0.1 }, confidence: 0.8 },
    novelty: { type: 'score', score: 1.5, legend: { '0': 'Duplicate', '1': 'Incremental', '2': 'New', '3': 'Highly novel' },
      probabilities: { '0': 0.1, '1': 0.4, '2': 0.4, '3': 0.1 }, confidence: 0.4 }
  }, usage: { input_tokens: 200, output_tokens: 32 } };
}
async function register(): Promise<{ context: JudgeContext; plan: CloudPlan; planHash: string }> {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const artifact = await sha256(wasm);
  const module = { id: 'C-base', module: 'gcd.wasm', strategy: 'euclid', generator: { provider: 'manual', model: 'reviewed', revision: null } };
  const plan: CloudPlan = { schema_version: 1, requested_experiment: 'EXP-label', config: {
    schema_version: 1, project: 'PRJ-test', experiment: `EXP-${crypto.randomUUID()}`, cell: 'Gcd', intent: 'INT-test', hypothesis: 'H-test',
    baseline: module, candidates: [{ ...module, id: 'C-new' }], harness: { entrypoint: 'gcd', public_cases: [[0, 0]], oracle_seed: 987654321,
      hidden_cases: 16, hidden_max_input: 1024, benchmark_samples: 3, benchmark_rounds: 2, fuel_per_call: 50000, memory_pages: 32 },
    min_relative_improvement: 0.01, max_wall_clock_seconds: 60 }, module_hashes: [artifact, artifact] };
  const bytes = encode(plan); const planHash = await sha256(bytes);
  await coordinate(env, plan.config.experiment, 'init', { experiment: plan.config.experiment, project: plan.config.project, planHash, count: 2 });
  await immutablePut(env.ARTIFACTS, `experiments/${plan.config.experiment}/plan.json`, bytes);
  await immutablePut(env.ARTIFACTS, `artifacts/${artifact}.wasm`, wasm);
  return { plan, planHash, context: { schema_version: 1, experiment: plan.config.experiment, candidate: 'C-new', artifact_hash: artifact,
    contract_summary: 'gcd(u32,u32) returns greatest common divisor', intent_summary: 'reduce fuel', candidate_summary: 'Euclidean remainder loop',
    high_impact: false, known_failures: [] } };
}
describe('advisory judge', () => {
  it('normalizes the documented typed answers and rejects contradictory distributions', () => {
    const normalized = normalizeClef(response(), 'flash', hash, hash, 12);
    expect(normalized.answers.novelty).toEqual([0.1, 0.4, 0.4, 0.1]);
    expect(normalized.stage).toBe('l1a'); expect(normalized.token_usage?.input_tokens).toBe(200);
    const missing = { ...response(), usage: undefined };
    expect(normalizeClef(missing, 'flash', hash, hash, 12).token_usage).toBeNull();
    const invalid = response(); invalid.answers.architectural_fit.probabilities.good = 1;
    expect(() => normalizeClef(invalid, 'flash', hash, hash, 12)).toThrow();
    const score = response(); score.answers.novelty.score = 2;
    expect(() => normalizeClef(score, 'flash', hash, hash, 12)).toThrow('score');
    expect(() => normalizeClef(response('clef'), 'flash', hash, hash, 12)).toThrow('model');
    const rounded = response(); rounded.answers.novelty.score = 1.1196;
    rounded.answers.novelty.probabilities = { '0': 0.3286, '1': 0.3264, '2': 0.2419, '3': 0.1031 };
    rounded.answers.architectural_fit.probabilities = { good: 0.8717, uncertain: 0.0492, poor: 0.079 };
    const stable = normalizeClef(rounded, 'flash', hash, hash, 12);
    expect(stable.answers.architectural_fit.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(stable.adapter_version).toBe('clef-adapter-v2');
  });
  it('retains exact bytes, authenticates access and reuses a paid response', async () => {
    const { context } = await register(); const bytes = encode(context);
    const run = vi.fn(async () => response()); const bindings = { ...env, AI: { run } } as Env;
    const first = await (await judge(bindings, bytes, 'flash')).json() as { judgement: string; input_hash: string; advisory_only: boolean };
    expect(first.advisory_only).toBe(true); expect(first.input_hash).toBe(await sha256(bytes));
    expect(await (await judge(bindings, bytes, 'flash')).json()).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await (await readJudgement(env, first.judgement, 'context')).text()).toBe(new TextDecoder().decode(bytes));
    expect((await SELF.fetch(`https://ace/v1/judgements/${first.judgement}`)).status).toBe(401);
    expect((await SELF.fetch('https://ace/v1/judge/flash', { method: 'POST', body: bytes })).status).toBe(401);
    const state = await coordinate(env, context.experiment, 'status') as { completed: number };
    expect(state.completed).toBe(0);
  });
  it('records provider faults without assigning a correctness result', async () => {
    for (const bad of [false, true]) {
      const { context } = await register();
      const bindings = { ...env, AI: { run: async () => { if (bad) return { answers: {} }; throw new Error('private provider diagnostic'); } } } as Env;
      const manifest = await (await judge(bindings, encode(context), 'flash')).json() as { judgement: string; fault: string };
      expect(manifest.fault).toBe(bad ? 'invalid_response' : 'unavailable');
      const attempt = await (await readJudgement(env, manifest.judgement, 'attempt')).json() as { result: unknown; fault: string };
      expect(attempt.result).toBeNull(); expect(attempt.fault).toBe(manifest.fault);
      expect(JSON.stringify(manifest)).not.toContain('private provider');
    }
  });
  it('repairs interrupted publication from the retained response without paid retries', async () => {
    const { context } = await register(); const run = vi.fn(async () => response());
    const original = env.ARTIFACTS;
    const artifacts = new Proxy(original, { get(target, property) {
      if (property === 'put') return async (key: string, value: unknown, options: unknown) => {
        if (key.endsWith('/attempt.json')) throw new Error('transient R2 fault');
        return target.put(key, value as string, options as R2PutOptions);
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(judge({ ...env, ARTIFACTS: artifacts, AI: { run } }, encode(context), 'flash')).rejects.toThrow('R2 fault');
    const recovered = await (await judge({ ...env, AI: { run } }, encode(context), 'flash')).json() as { fault: unknown };
    expect(recovered.fault).toBeNull(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('rejects unregistered artifacts before inference and detects stored corruption', async () => {
    const { context } = await register(); const run = vi.fn(async () => response());
    await expect(judge({ ...env, AI: { run } }, encode({ ...context, artifact_hash: hash }), 'flash')).rejects.toThrow('not registered');
    expect(run).not.toHaveBeenCalled();
    const manifest = await (await judge({ ...env, AI: { run } }, encode(context), 'flash')).json() as { judgement: string };
    await env.ARTIFACTS.put(`judgements/${manifest.judgement}/context.json`, '{}');
    await expect(readJudgement(env, manifest.judgement, 'context')).rejects.toThrow('corrupted');
  });
  it('enforces exclusive inference reservations and a daily attempt limit', async () => {
    const name = `JUDGE-BUDGET-test-${crypto.randomUUID()}`;
    const pair = await Promise.all([coordinate(env, name, 'judge-claim', { key: 'same' }), coordinate(env, name, 'judge-claim', { key: 'same' })]) as { disposition: string; token?: string }[];
    expect(pair.map(c => c.disposition).sort()).toEqual(['busy', 'claimed']);
    const winner = pair.find(c => c.token)!;
    await expect(coordinate(env, name, 'judge-complete', { key: 'same', token: 'wrong' })).rejects.toThrow('reservation');
    await coordinate(env, name, 'judge-complete', { key: 'same', token: winner.token });
    expect((await coordinate(env, name, 'judge-claim', { key: 'same' }) as { disposition: string }).disposition).toBe('done');
    for (let i = 1; i < 64; i++) expect((await coordinate(env, name, 'judge-claim', { key: String(i) }) as { disposition: string }).disposition).toBe('claimed');
    expect((await coordinate(env, name, 'judge-claim', { key: 'overflow' }) as { disposition: string }).disposition).toBe('budget');
  });
  it('retrieves failure references without exposing hidden Oracle inputs or current labels', async () => {
    const source = await register(); const target = await register(); const evidence = 'EV-failure';
    // Mock report: this tests transport/privacy, not Rust qualification or seals.
    const report = { report: { config: source.plan.config, results: [{ candidate: { id: 'C-base', patch: { hash } },
      evidence: { content_hash: hash, evidence: { id: evidence } }, evaluation: { outcome: 'failed_correctness', error: 'secret Oracle (12345, 67890)' } }] } };
    const reportBytes = encode(report); const key = `experiments/${source.context.experiment}/run.json`;
    await immutablePut(env.ARTIFACTS, key, reportBytes);
    for (const index of [0, 1, 'final']) {
      const claim = await coordinate(env, source.context.experiment, 'claim', { experiment: source.context.experiment, planHash: source.planHash, index }) as { token: string };
      await coordinate(env, source.context.experiment, 'complete', { planHash: source.planHash, index, token: claim.token, resultKey: key, resultHash: await sha256(reportBytes) });
    }
    target.context.known_failures = [{ experiment: source.context.experiment, evidence, content_hash: hash }];
    const run = vi.fn(async () => response());
    await judge({ ...env, AI: { run } }, encode(target.context), 'flash');
    const request = JSON.stringify(run.mock.calls[0]);
    expect(request).toContain('failed_correctness'); expect(request).toContain('euclid');
    expect(request).not.toContain('987654321'); expect(request).not.toContain('12345'); expect(request).not.toContain('secret Oracle');
    report.report.results[0]!.candidate.patch.hash = target.context.artifact_hash;
    const newer = encode(report); await env.ARTIFACTS.put(key, newer);
    // Corruption is rejected before a modified report can leak a label.
    await expect(judge({ ...env, AI: { run } }, encode(target.context), 'clef')).rejects.toThrow('corrupted');
  });
});
