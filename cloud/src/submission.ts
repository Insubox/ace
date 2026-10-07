import {type Env,type ExperimentState,planSchema,strictJson,sha256,coordinate,immutablePut,json,HttpError} from './contracts';
export async function submit(env: Env, bytes: Uint8Array): Promise<Response> {
  const p = planSchema.parse(strictJson(new TextDecoder().decode(bytes)));
  const experiment = p.config.experiment;
  const planHash = await sha256(bytes);
  for (const artifact of new Set(p.module_hashes)) {
    if (!await env.ARTIFACTS.head(`artifacts/${artifact}.wasm`)) throw new HttpError(409, `module ${artifact} must be uploaded first`);
  }
  const state = await coordinate(env, experiment, 'init', { experiment, project: p.config.project, planHash, count: p.module_hashes.length }) as ExperimentState;
  await immutablePut(env.ARTIFACTS, `experiments/${experiment}/plan.json`, bytes);
  await env.DB.prepare('INSERT INTO experiments (id, project, plan_hash, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(experiment, p.config.project, planHash, state.status, Date.now()).run();
  // An identical HTTP retry repairs interrupted registration/startup.
  try { await env.EXPERIMENTS.create({ id: experiment, params: { experiment, planHash } }); }
  catch (e) {
    const existing = await env.EXPERIMENTS.get(experiment);
    const observed = await existing.status();
    if (!observed.status || observed.status === 'unknown') throw e;
  }
  return json({ experiment, planHash, status: state.status }, 202);
}
