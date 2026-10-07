import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { type Env, coordinate, sha256 } from '../src/contracts';
import { generate, readGeneration, normalizeGeneration, generationRequest, taskSchema, MODELS, type Task } from '../src/generator';

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const source = '(module (func (export "gcd") (param i32 i32) (result i32) local.get 0))';
const hash = '0'.repeat(64);
async function task(): Promise<Task> {
  return { context_hash: hash, context: { schema_version: 1, campaign: `test-${crypto.randomUUID()}`, round: 1, attempt: 1, max_candidates: 2,
    previous_fault: null, contract: { cell: 'Gcd', abi: 'gcd(i32,i32)->i32', semantics: 'gcd(0,0)=0', objective: 'reduce fuel',
      public_cases: [[0,0]], fuel_per_call: 50000, memory_pages: 16, min_relative_improvement: 0.01 },
    memory: { schema_version: 1, project: 'PRJ-test', cell: 'Gcd', intent: 'INT-test', environment_hash: hash, evalspec_hash: hash,
      compatible_runs: 1, excluded_runs: 0, truncated: false, seen_artifacts: [hash], observations: [],
      winner: { experiment: 'EXP-fixture', candidate: 'C-fixture', report_hash: hash, artifact_hash: hash,
        source_hash: await sha256(new TextEncoder().encode(source)), wat: source, mean_fuel: '100', strategy: 'fixture',
        evidence: 'EV-fixture', evidence_hash: hash, commit: '0'.repeat(40) } } } };
}
const raw = () => ({ response: JSON.stringify({ candidates: [{ id: 'C-new', wat: source, strategy: 'fixture' }] }), usage: { prompt_tokens: 100, completion_tokens: 50 } });

describe('agent code generation', () => {
  it('bounds the public contract and normalizes source without treating generation as qualification', async () => {
    const context = await task();
    expect(taskSchema.parse(context)).toEqual(context);
    const normalized = normalizeGeneration(raw(), context, MODELS.qwen);
    expect(normalized.candidates[0]?.generator.provider).toBe('cloudflare-workers-ai');
    expect(normalized.candidates[0]?.generator.model).toBe(MODELS.qwen);
    const injection = { response: JSON.stringify({ candidates: [{ id: 'C-new', wat: source, strategy: 'fixture', evalspec: {} }] }) };
    expect(() => normalizeGeneration(injection, context, MODELS.qwen)).toThrow();
    const duplicate = { response: JSON.stringify({ candidates: [normalized.candidates[0], normalized.candidates[0]] }) };
    expect(() => normalizeGeneration(duplicate, context, MODELS.qwen)).toThrow();
    expect(() => taskSchema.parse({ ...context, context: { ...context.context, oracle_seed: 123 } })).toThrow();
    const request = generationRequest(context);
    expect(request.max_tokens).toBe(4096);
    expect(JSON.stringify(request)).not.toContain('oracle_seed');
    expect(JSON.stringify(request)).not.toContain('hidden_cases');
  });
  it('retains raw inference and exact task bytes and reuses a paid generation', async () => {
    const context = await task(); const input = encode(context);
    const run = vi.fn(async () => raw()); const bindings = { ...env, AI: { run } } as Env;
    const result = await (await generate(bindings, input, 'qwen')).json() as { generation: string; input_hash: string; context_hash: string; real_evaluation_required: boolean };
    expect(result.real_evaluation_required).toBe(true);
    expect(result.input_hash).toBe(await sha256(input)); expect(result.context_hash).toBe(hash);
    expect(await (await generate(bindings, input, 'qwen')).json()).toEqual(result); expect(run).toHaveBeenCalledTimes(1);
    expect(await (await readGeneration(env, result.generation, 'context')).text()).toBe(new TextDecoder().decode(input));
    const attempt = await (await readGeneration(env, result.generation, 'attempt')).json() as { result: unknown; fault: unknown };
    expect(attempt.result).toBeTruthy(); expect(attempt.fault).toBeNull();
    expect((await SELF.fetch('https://ace/v1/generate/qwen', { method: 'POST', body: input })).status).toBe(401);
    expect((await SELF.fetch(`https://ace/v1/generations/${result.generation}`)).status).toBe(401);
  });
  it('records malformed or unavailable generators without assigning candidate outcomes', async () => {
    for (const malformed of [false, true]) {
      const input = encode(await task());
      const run = async () => { if (malformed) return { response: '{"not_candidates":true}' }; throw new Error('private provider error'); };
      const result = await (await generate({ ...env, AI: { run } }, input, 'llama')).json() as { generation: string; fault: string };
      expect(result.fault).toBe(malformed ? 'invalid_response' : 'unavailable');
      const attempt = await (await readGeneration(env, result.generation, 'attempt')).json() as { result: unknown };
      expect(attempt.result).toBeNull(); expect(JSON.stringify(result)).not.toContain('private provider error');
    }
  });
  it('repairs interrupted result publication without another provider call', async () => {
    const input = encode(await task()); const run = vi.fn(async () => raw());
    const artifacts = new Proxy(env.ARTIFACTS, { get(target, property) {
      if (property === 'put') return async (key: string, value: unknown, options: unknown) => {
        if (key.endsWith('/attempt.json')) throw new Error('transient R2 failure');
        return target.put(key, value as string, options as R2PutOptions);
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(generate({ ...env, ARTIFACTS: artifacts, AI: { run } }, input, 'qwen')).rejects.toThrow('R2 failure');
    const recovered = await (await generate({ ...env, AI: { run } }, input, 'qwen')).json() as { fault: unknown };
    expect(recovered.fault).toBeNull(); expect(run).toHaveBeenCalledTimes(1);
  });
  it('enforces the separate daily paid-call cap before invoking the model', async () => {
    const budget = `GENERATOR-BUDGET-${new Date().toISOString().slice(0,10)}`;
    for (let i=0;i<16;i++) await coordinate(env, budget, 'generator-claim', { key: `spent-${i}` });
    const run = vi.fn(async () => raw());
    const result = await (await generate({ ...env, AI: { run } }, encode(await task()), 'qwen')).json() as { fault: string };
    expect(result.fault).toBe('budget_exhausted'); expect(run).not.toHaveBeenCalled();
    const judge = await coordinate(env, `JUDGE-BUDGET-${crypto.randomUUID()}`, 'judge-claim', { key: 'independent' }) as { disposition: string };
    expect(judge.disposition).toBe('claimed');
  });
  it('rejects mismatched winner source and detects corrupted retained records', async () => {
    const context = await task(); const run = vi.fn(async () => raw());
    await expect(generate({ ...env, AI: { run } }, encode({ ...context, context: { ...context.context,
      memory: { ...context.context.memory, winner: { ...context.context.memory.winner, wat: '(module)' } } } }), 'qwen')).rejects.toThrow('source hash');
    expect(run).not.toHaveBeenCalled();
    const result = await (await generate({ ...env, AI: { run } }, encode(context), 'qwen')).json() as { generation: string };
    await env.ARTIFACTS.put(`generations/${result.generation}/attempt.json`, 'changed');
    await expect(readGeneration(env, result.generation, 'attempt')).rejects.toThrow('corrupted');
  });
});
