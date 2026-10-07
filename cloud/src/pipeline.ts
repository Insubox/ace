import { type Env, type Job, type FinalizeJob, type ExperimentState, type Task, type CloudPlan,
  coordinate, sha256, immutablePut, jobSchema, hash, identifier } from './contracts';
import { z } from 'zod';

type Claim = { disposition: 'claimed' | 'busy' | 'done' | 'terminal'; token?: string; task?: Task; state?: ExperimentState };
const observationSchema = z.object({ content_hash: hash, observation: z.object({ index: z.number().int(), module_hash: hash, plan_hash: hash }) });
const filesSchema = z.array(z.strictObject({ path: z.string().regex(/^(?:run|environment|intent|experiment|knowledge|champion|baseline-champion)\.json$|^candidates\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/(?:candidate|evaluation|evidence|decision)\.json$/), content: z.string().max(3_145_728) })).min(1).max(420);

export async function notify(env: Env, experiment: string, state: ExperimentState): Promise<void> {
  const types: string[] = [];
  if (state.completed === state.count || state.status === 'failed') types.push('evaluated');
  if (state.status === 'completed' || state.status === 'failed') types.push('finalized');
  if (!types.length) return;
  const instance = await env.EXPERIMENTS.get(experiment);
  for (const type of types) {
    try { await instance.sendEvent({ type, payload: {} }); }
    catch (e) {
      const observed = await instance.status();
      if (['complete', 'errored', 'terminated'].includes(observed.status)) return;
      throw e;
    }
  }
}
async function mirror(env: Env, state: ExperimentState): Promise<void> {
  await env.DB.prepare('UPDATE experiments SET status = ?, report_key = ?, error = ? WHERE id = ?')
    .bind(state.status, state.reportKey ?? null, state.error ?? null, state.experiment).run();
}
async function plan(env: Env, job: FinalizeJob): Promise<CloudPlan> {
  const object = await env.ARTIFACTS.get(`experiments/${job.experiment}/plan.json`);
  if (!object) throw new Error('plan missing');
  const bytes = await object.arrayBuffer();
  if (await sha256(bytes) !== job.planHash) throw new Error('plan changed');
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function mirrorEvaluation(env: Env, job: Job, task: Task): Promise<void> {
  const p = await plan(env, job);
  const candidate = job.index === 0 ? p.config.baseline : p.config.candidates[job.index - 1]!;
  await env.DB.prepare('INSERT INTO evaluations (experiment, task_index, candidate, artifact_hash, observation_key, observation_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(experiment, task_index) DO NOTHING')
    .bind(job.experiment, job.index, candidate.id, p.module_hashes[job.index], task.resultKey, task.resultHash).run();
}
async function mirrorFinal(env: Env, state: ExperimentState): Promise<void> {
  if (!state.reportKey) throw new Error('final report missing');
  const object = await env.ARTIFACTS.get(state.reportKey);
  if (!object) throw new Error('final report missing');
  const manifest = await object.json<{ report: { results: { candidate: { id: string }; evidence: { evidence: { id: string }; content_hash: string } }[] } }>();
  const prefix = state.reportKey.slice(0, -'run.json'.length);
  const statements = manifest.report.results.map(result => {
    identifier.parse(result.candidate.id); identifier.parse(result.evidence.evidence.id); hash.parse(result.evidence.content_hash);
    return env.DB.prepare('INSERT INTO evidence_index (experiment, candidate, evidence_id, content_hash, document_key) VALUES (?, ?, ?, ?, ?) ON CONFLICT(experiment, candidate) DO NOTHING')
      .bind(state.experiment, result.candidate.id, result.evidence.evidence.id, result.evidence.content_hash, `${prefix}candidates/${result.candidate.id}/evidence.json`);
  });
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  await mirror(env, state);
}

export async function consumeEvaluation(env: Env, input: unknown): Promise<'ack' | 'retry'> {
  const job = jobSchema.parse(input);
  const claim = await coordinate(env, job.experiment, 'claim', job) as Claim;
  if (claim.disposition === 'busy') return 'retry';
  if (claim.disposition === 'terminal') { if (claim.state!.tasks[job.index]?.resultKey) await mirrorEvaluation(env, job, claim.state!.tasks[job.index]!); await mirror(env, claim.state!); await notify(env, job.experiment, claim.state!); return 'ack'; }
  if (claim.disposition === 'done') { await mirrorEvaluation(env, job, claim.task!); await mirror(env, claim.state!); await notify(env, job.experiment, claim.state!); return 'ack'; }
  try {
    const output = await env.SANDBOXES.getByName(`${job.experiment}-${job.index}-${claim.token}`).evaluate(job);
    const bytes = new TextEncoder().encode(output);
    if (bytes.length > 128_000) throw new Error('oversized evaluator output');
    const parsed = observationSchema.parse(JSON.parse(output));
    const p = await plan(env, job);
    if (parsed.observation.index !== job.index || parsed.observation.module_hash !== p.module_hashes[job.index]) throw new Error('evaluator task mismatch');
    const resultKey = `experiments/${job.experiment}/observations/${job.index}/${claim.token}.json`;
    const resultHash = await sha256(bytes);
    await immutablePut(env.ARTIFACTS, resultKey, bytes);
    const completed = await coordinate(env, job.experiment, 'complete', { ...job, token: claim.token, resultKey, resultHash }) as { state: ExperimentState };
    await mirrorEvaluation(env, job, completed.state.tasks[job.index]!);
    await mirror(env, completed.state);
    await notify(env, job.experiment, completed.state);
    return 'ack';
  } catch (e) { await coordinate(env, job.experiment, 'release', { ...job, token: claim.token }); throw e; }
}

export async function consumeFinalization(env: Env, job: FinalizeJob): Promise<'ack' | 'retry'> {
  identifier.parse(job.experiment); hash.parse(job.planHash);
  const claim = await coordinate(env, job.experiment, 'claim', { ...job, index: 'final' }) as Claim;
  if (claim.disposition === 'busy') return 'retry';
  if (claim.disposition === 'terminal' || claim.disposition === 'done') {
    if (claim.state!.status === 'completed') await mirrorFinal(env, claim.state!); else await mirror(env, claim.state!);
    await notify(env, job.experiment, claim.state!); return 'ack';
  }
  try {
    const keys = claim.state!.tasks.map(task => task.resultKey!);
    // Verify accepted observations' transport hashes before trusted aggregation.
    for (const [i, key] of keys.entries()) {
      const object = await env.ARTIFACTS.get(key);
      if (!object || await sha256(await object.arrayBuffer()) !== claim.state!.tasks[i]!.resultHash) throw new Error('accepted observation corrupted');
    }
    const files = filesSchema.parse(await env.SANDBOXES.getByName(`${job.experiment}-final-${claim.token}`).finalize(job, keys));
    if (new Set(files.map(f => f.path)).size !== files.length || !files.some(f => f.path === 'run.json')) throw new Error('incomplete run export');
    const prefix = `experiments/${job.experiment}/runs/${claim.token}/`;
    // Completion manifest is last; incomplete exports never become visible runs.
    files.sort((a, b) => Number(a.path === 'run.json') - Number(b.path === 'run.json'));
    for (const file of files) await immutablePut(env.ARTIFACTS, prefix + file.path, new TextEncoder().encode(file.content));
    const run = files.find(f => f.path === 'run.json')!;
    const completed = await coordinate(env, job.experiment, 'complete', { ...job, index: 'final', token: claim.token,
      resultKey: prefix + 'run.json', resultHash: await sha256(new TextEncoder().encode(run.content)) }) as { state: ExperimentState };
    await mirrorFinal(env, completed.state); await notify(env, job.experiment, completed.state); return 'ack';
  } catch (e) { await coordinate(env, job.experiment, 'release', { ...job, index: 'final', token: claim.token }); throw e; }
}

export async function failExperiment(env: Env, job: FinalizeJob, error: string): Promise<void> {
  const result = await coordinate(env, job.experiment, 'fail', { ...job, error }) as { state: ExperimentState };
  await mirror(env, result.state); await notify(env, job.experiment, result.state);
}
