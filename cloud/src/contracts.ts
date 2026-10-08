import { z } from 'zod';

export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const hash = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().max(8192).refine(s => s.trim().length > 0);
const uint = (min: number, max: number) => z.number().int().min(min).max(max);
const moduleSpec = z.strictObject({ id: identifier, module: text.refine(s => !s.startsWith('/')), strategy: text,
  generator: z.strictObject({ provider: text, model: text, revision: text.nullable() }) });
export const planSchema = z.strictObject({
  schema_version: z.literal(1), requested_experiment: identifier,
  config: z.strictObject({
    schema_version: z.literal(1), project: identifier, experiment: identifier, cell: identifier, intent: identifier, hypothesis: identifier,
    baseline: moduleSpec, candidates: z.array(moduleSpec).min(1).max(100),
    harness: z.strictObject({ oracle:z.enum(['gcd','max_u32','min_u32']).optional(),entrypoint: identifier, public_cases: z.array(z.tuple([uint(0, 4294967295), uint(0, 4294967295)])).min(1).max(128),
      oracle_seed: uint(0, Number.MAX_SAFE_INTEGER), hidden_cases: uint(1, 1024), hidden_max_input: uint(1, 65535),
      benchmark_samples: uint(1, 31), benchmark_rounds: uint(1, 32), fuel_per_call: uint(1, 1_000_000), memory_pages: uint(1, 64) }),
    min_relative_improvement: z.number().min(0).lt(1), max_wall_clock_seconds: uint(1, 300)
  }), module_hashes: z.array(hash).min(2).max(101)
}).superRefine((p, ctx) => {
  const profile=({Gcd:['gcd','gcd'],MaxU32:['max_u32','max_u32'],MinU32:['min_u32','min_u32']} as Record<string,string[]>)[p.config.cell];
  if(!profile||(p.config.harness.oracle??'gcd')!==profile[0]||p.config.harness.entrypoint!==profile[1])ctx.addIssue({code:'custom',message:'Cell, entrypoint and independent host oracle must agree'});
  const ids = [p.config.baseline.id, ...p.config.candidates.map(c => c.id)];
  if (new Set(ids).size !== ids.length || p.module_hashes.length !== ids.length)
    ctx.addIssue({ code: 'custom', message: 'duplicate candidate or mismatched module population' });
});
export type CloudPlan = z.infer<typeof planSchema>;
export const jobSchema = z.strictObject({ experiment: identifier, index: uint(0, 100), planHash: hash });
export type Job = z.infer<typeof jobSchema>;
export type FinalizeJob = Omit<Job, 'index'>;
export type Task = { attempts: number; token?: string; leaseUntil?: number; resultKey?: string; resultHash?: string };
export type ExperimentState = {
  experiment: string; project: string; planHash: string; count: number; completed: number;
  status: 'registered' | 'running' | 'finalizing' | 'completed' | 'failed';
  deadline: number; tasks: Task[]; finalizer: Task; error?: string; reportKey?: string;
};
export type Env = {
  SPENDING_CONTROL_MODE?: 'enforce'|'local-disabled';
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  API_TOKEN: string;
  NATIVE_VERIFIER_BINARY_HASH?: string;
  APPLICATION_IMAGE_HASH?:string;
  NATIVE_VERIFICATIONS: Workflow<import('./verification').VerificationJob>;
  DB: D1Database; ARTIFACTS: R2Bucket;
  BACKUPS?:R2Bucket; RESTORE_STORAGE?:R2Bucket; RESTORE_DB?:D1Database;
  RESTORE_COORDINATORS?:DurableObjectNamespace; BACKUP_WORKFLOW?:Workflow<import('./backups').BackupJob>;
  COORDINATORS: DurableObjectNamespace;
  SANDBOXES: DurableObjectNamespace<import('./sandbox').EvaluationSandbox>;
  EVALUATIONS: Queue<Job>; FINALIZATIONS: Queue<FinalizeJob>;
  EXPERIMENTS: Workflow<FinalizeJob>;
  APPLICATION_RUNS?:Workflow<import('./applications').AppJob>;
  APPLICATION_CAMPAIGNS?:Workflow<import('./application-campaigns').CampaignJob>;
  OBSERVATORY_TRIALS?:Workflow<import('./observatory').TrialJob>;
};

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const json = (value: unknown, status = 200) => Response.json(value, { status });
export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'request exceeds size limit'); } chunks.push(value); }
  const out = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out;
}

// Reject duplicate keys (including escaped equivalents) before JSON.parse.
export function strictJson(source: string): unknown {
  let at = 0; let depth = 0;
  const ws = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  const string = (): string => {
    const start = at++; while (at < source.length) { const c = source[at++]; if (c === '\\') at++; else if (c === '"') {const value=JSON.parse(source.slice(start, at)) as string;if(!value.isWellFormed())throw new HttpError(400,'invalid Unicode string');return value;} }
    throw new HttpError(400, 'unterminated string');
  };
  const value = (): void => {
    ws(); if (++depth > 64) throw new HttpError(400, 'JSON nesting limit');
    if (source[at] === '{') { at++; ws(); const keys = new Set<string>();
      if (source[at] !== '}') while (true) { ws(); if (source[at] !== '"') throw new HttpError(400, 'invalid object');
        const key = string(); if (keys.has(key)) throw new HttpError(400, 'duplicate JSON key'); keys.add(key);
        ws(); if (source[at++] !== ':') throw new HttpError(400, 'invalid object'); value(); ws(); if (source[at] !== ',') break; at++; }
      if (source[at++] !== '}') throw new HttpError(400, 'invalid object');
    } else if (source[at] === '[') { at++; ws(); if (source[at] !== ']') while (true) { value(); ws(); if (source[at] !== ',') break; at++; }
      if (source[at++] !== ']') throw new HttpError(400, 'invalid array');
    } else if (source[at] === '"') string();
    else { const start = at; while (at < source.length && !/[\s,\]}]/.test(source[at]!)) at++; if (at === start) throw new HttpError(400, 'invalid value'); }
    depth--;
  };
  try { value(); ws(); if (at !== source.length) throw new Error('trailing JSON'); return JSON.parse(source); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'invalid JSON'); }
}

export async function immutablePut(bucket: R2Bucket, key: string, bytes: Uint8Array): Promise<void> {
  const result = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' } });
  if (!result) {
    const existing = await bucket.get(key);
    if (!existing || await sha256(await existing.arrayBuffer()) !== await sha256(bytes)) throw new HttpError(409, 'immutable artifact conflict');
  }
}
export async function coordinate(env: Env, experiment: string, op: string, data: unknown = {}): Promise<unknown> {
  const response = await env.COORDINATORS.get(env.COORDINATORS.idFromName(experiment)).fetch(new Request(`https://coordinator/${op}`, {
    method: 'POST', body: JSON.stringify(data) }));
  const body = await response.json();
  if (!response.ok) throw new HttpError(response.status, (body as {error: string}).error);
  return body;
}
