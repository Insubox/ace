import { DurableObject } from 'cloudflare:workers';
import { type Env, type ExperimentState, type Task, HttpError, json } from './contracts';

export class ExperimentCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      const op = new URL(request.url).pathname.slice(1);
      const body = await request.json() as Record<string, unknown>;
      const result = await this.ctx.storage.transaction(async tx => {
        // Separate daily DO names hold advisory inference reservations, never
        // candidate evaluation state. Each actual provider attempt spends a slot.
        if (op === 'judge-claim') {
          const key = `judge:${body.key}`;
          const previous = await tx.get<{ done?: boolean; token: string; leaseUntil: number }>(key);
          if (previous?.done) return { disposition: 'done' };
          if ((previous?.leaseUntil ?? 0) > Date.now()) return { disposition: 'busy' };
          const used = await tx.get<number>('judge-used') ?? 0;
          if (used >= 64) return { disposition: 'budget' };
          const token = crypto.randomUUID();
          await tx.put('judge-used', used + 1);
          await tx.put(key, { token, leaseUntil: Date.now() + 120_000 });
          return { disposition: 'claimed', token };
        }
        if (op === 'judge-complete') {
          const key = `judge:${body.key}`;
          const previous = await tx.get<{ token: string; leaseUntil: number }>(key);
          if (!previous || previous.token !== body.token || previous.leaseUntil <= Date.now()) throw new HttpError(409, 'expired judge reservation');
          await tx.put(key, { ...previous, done: true });
          return { disposition: 'done' };
        }
        let state = await tx.get<ExperimentState>('state');
        if (op === 'init') {
          if (state && state.planHash !== body.planHash) throw new HttpError(409, 'experiment identity already registered with another plan');
          if (!state) {
            const count = body.count as number;
            if (!Number.isInteger(count) || count < 2 || count > 101) throw new HttpError(400, 'invalid population');
            state = { experiment: body.experiment as string, project: body.project as string, planHash: body.planHash as string,
              count, completed: 0, status: 'registered', deadline: Date.now() + 3_600_000,
              tasks: Array.from({ length: count }, () => ({ attempts: 0 })), finalizer: { attempts: 0 } };
            await tx.put('state', state);
          }
          return state;
        }
        if (!state) throw new HttpError(404, 'experiment not found');
        if (op === 'status') return state;
        if (body.planHash !== state.planHash) throw new HttpError(409, 'stale queue plan');
        if (op === 'fail') {
          if (state.status !== 'completed') { state.status = 'failed'; state.error = String(body.error).slice(0, 512); }
        } else if (state.status === 'failed' || state.status === 'completed') return { disposition: 'terminal', state };
        else if (Date.now() > state.deadline) { state.status = 'failed'; state.error = 'experiment deadline exceeded'; }
        else if (op === 'dispatch') { if (state.status === 'registered') state.status = 'running'; }
        else {
          const final = body.index === 'final';
          const index = body.index as number;
          if (!final && (!Number.isInteger(index) || index < 0 || index >= state.count)) throw new HttpError(400, 'unregistered task');
          const task: Task = final ? state.finalizer : state.tasks[index]!;
          if (final && state.completed !== state.count) throw new HttpError(409, 'cannot finalize an incomplete population');
          if (op === 'claim') {
            if (task.resultKey) return { disposition: 'done', task, state };
            if ((task.leaseUntil ?? 0) > Date.now()) return { disposition: 'busy' };
            if (task.attempts >= 3) { state.status = 'failed'; state.error = 'trusted evaluator retry budget exhausted'; }
            else { task.attempts++; task.token = crypto.randomUUID(); task.leaseUntil = Date.now() + 900_000;
              if (final) state.status = 'finalizing'; await tx.put('state', state);
              return { disposition: 'claimed', token: task.token, state }; }
          } else if (op === 'release') {
            if (task.token === body.token && !task.resultKey) task.leaseUntil = 0;
          } else if (op === 'complete') {
            if (task.resultKey) return { disposition: 'done', task, state };
            if (task.token !== body.token || (task.leaseUntil ?? 0) <= Date.now()) throw new HttpError(409, 'expired or superseded evaluator lease');
            task.resultKey = body.resultKey as string; task.resultHash = body.resultHash as string; task.leaseUntil = 0;
            if (final) { state.status = 'completed'; state.reportKey = task.resultKey; }
            else state.completed++;
          } else throw new HttpError(404, 'unknown coordinator operation');
        }
        await tx.put('state', state);
        return { disposition: state.status === 'failed' ? 'terminal' : 'ok', state };
      });
      return json(result);
    } catch (e) { return json({ error: e instanceof Error ? e.message : 'coordinator error' }, e instanceof HttpError ? e.status : 500); }
  }
}
