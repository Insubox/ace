import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { type Env, type FinalizeJob, type ExperimentState, coordinate } from './contracts';
import { failExperiment } from './pipeline';

export class ExperimentWorkflow extends WorkflowEntrypoint<Env, FinalizeJob> {
  async run(event: WorkflowEvent<FinalizeJob>, step: WorkflowStep): Promise<unknown> {
    const job = event.payload;
    try {
      await step.do('dispatch evaluations', async () => {
        const { state } = await coordinate(this.env, job.experiment, 'dispatch', job) as { state: ExperimentState };
        if (state.status === 'failed') throw new Error('experiment already failed');
        const tasks = Array.from({ length: state.count }, (_, index) => ({ body: { ...job, index } }));
        for (let i = 0; i < tasks.length; i += 100) await this.env.EVALUATIONS.sendBatch(tasks.slice(i, i + 100));
      });
      await step.waitForEvent('wait for evaluations', { type: 'evaluated', timeout: '1 hour' });
      await step.do('dispatch aggregation', async () => {
        const state = await coordinate(this.env, job.experiment, 'status') as ExperimentState;
        if (state.status === 'failed' || state.completed !== state.count) throw new Error('population failed or incomplete');
        await this.env.FINALIZATIONS.send(job);
      });
      await step.waitForEvent('wait for aggregation', { type: 'finalized', timeout: '30 minutes' });
      return await step.do('verified completion', async () => {
        const state = await coordinate(this.env, job.experiment, 'status') as ExperimentState;
        if (state.status !== 'completed') throw new Error('aggregation failed');
        return { experiment: job.experiment, report: state.reportKey };
      });
    } catch (e) {
      await step.do('record infrastructure failure', () => failExperiment(this.env, job, 'workflow exhausted retries or deadline; no qualification'));
      throw e;
    }
  }
}
