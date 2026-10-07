import { DurableObject } from 'cloudflare:workers';
import { Files } from '@cloudflare/sandbox';
import { type Env, type Job, type FinalizeJob, type CloudPlan, sha256 } from './contracts';

export type RunFile = { path: string; content: string };
export class EvaluationSandbox extends DurableObject<Env> {
  private async withContainer<T>(action: (files: Files, container: Container, signal: AbortSignal) => Promise<T>): Promise<T> {
    // Separate DO name per lease ensures retries never share a candidate instance.
    const container = this.ctx.container;
    if (!container) throw new Error('Cloudflare Container binding is not configured');
    const signal = AbortSignal.timeout(720_000);
    try {
      container.start({ image: container.images.ace, enableInternet: false });
      return await action(new Files(container), container, signal);
    } finally { await container.destroy(); }
  }
  private async plan(job: FinalizeJob): Promise<{ raw: string; plan: CloudPlan }> {
    const stored = await this.env.ARTIFACTS.get(`experiments/${job.experiment}/plan.json`);
    if (!stored) throw new Error('registered plan missing');
    const bytes = await stored.arrayBuffer();
    if (await sha256(bytes) !== job.planHash) throw new Error('registered plan corrupted');
    const raw = new TextDecoder().decode(bytes);
    return { raw, plan: JSON.parse(raw) as CloudPlan };
  }
  async evaluate(job: Job): Promise<string> {
    const { raw, plan } = await this.plan(job);
    const hash = plan.module_hashes[job.index];
    if (!hash) throw new Error('unregistered task index');
    const module = await this.env.ARTIFACTS.get(`artifacts/${hash}.wasm`);
    if (!module) throw new Error('registered module missing');
    const bytes = await module.arrayBuffer();
    if (await sha256(bytes) !== hash) throw new Error('module corrupted');
    return this.withContainer(async (files, container, signal) => {
      await files.writeFile('/workspace/plan.json', raw, { signal });
      await files.writeFile('/workspace/module.wasm', bytes, { signal });
      const process = await container.exec(['/usr/local/bin/ace', 'cloud', 'evaluate', '/workspace/plan.json',
        '--index', String(job.index), '--module', '/workspace/module.wasm', '--output', '/workspace/observation.json'], { signal });
      const result = await process.output();
      if (result.exitCode !== 0) throw new Error('trusted Rust evaluator could not produce an observation');
      return (await files.readFile('/workspace/observation.json', { signal })).text();
    });
  }
  async finalize(job: FinalizeJob, keys: string[]): Promise<RunFile[]> {
    const { raw, plan } = await this.plan(job);
    if (keys.length !== plan.module_hashes.length) throw new Error('incomplete observations');
    return this.withContainer(async (files, container, signal) => {
      await files.mkdir('/workspace/observations', { recursive: true, signal });
      await files.mkdir('/workspace/artifacts', { recursive: true, signal });
      await files.writeFile('/workspace/plan.json', raw, { signal });
      // Stream modules one at a time; the Worker does not hold 101 MiB of code.
      for (const hash of new Set(plan.module_hashes)) {
        const module = await this.env.ARTIFACTS.get(`artifacts/${hash}.wasm`);
        if (!module) throw new Error('module missing');
        await files.writeFile(`/workspace/artifacts/${hash}.wasm`, module.body, { signal });
      }
      for (const [index, key] of keys.entries()) {
        const observation = await this.env.ARTIFACTS.get(key);
        if (!observation) throw new Error('observation missing');
        await files.writeFile(`/workspace/observations/${index}.json`, observation.body, { signal });
      }
      const process = await container.exec(['/usr/local/bin/ace', 'cloud', 'finish', '/workspace/plan.json',
        '--observations', '/workspace/observations', '--artifacts', '/workspace/artifacts', '--output', '/workspace/run'], { signal });
      if ((await process.output()).exitCode !== 0) throw new Error('Rust aggregation rejected the observation set');
      const exportProcess = await container.exec(['python3', '/opt/ace/export_run.py'], { signal });
      if ((await exportProcess.output()).exitCode !== 0) throw new Error('run export failed');
      const response = await files.readFile('/workspace/bundle.json', { signal });
      return response.json<RunFile[]>();
    });
  }
}
