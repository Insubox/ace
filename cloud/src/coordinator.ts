import { DurableObject } from 'cloudflare:workers';
import { type Env, type ExperimentState, type Task, HttpError, json } from './contracts';
import { entrySchema,refSchema,type NativeRef, type NativeEntry } from './native-store';

export class ExperimentCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      const op = new URL(request.url).pathname.slice(1);
      const body = await request.json() as Record<string, unknown>;
      const result = await this.ctx.storage.transaction(async tx => {
        if(op==='setup-issue'){
          await tx.put('account-setup',{hash:body.hash,expires:body.expires,used:false});return{issued:true};
        }
        if(op==='setup-claim'){
          const ticket=await tx.get<{hash:string;expires:number;used:boolean}>('account-setup');
          if(!ticket||ticket.used||ticket.expires<=Date.now()||ticket.hash!==body.hash)throw new HttpError(401,'setup link expired or was already used');
          await tx.put('account-setup',{...ticket,used:true});return{claimed:true};
        }
        if(op==='backup-budget'){const used=await tx.get<number>('backup-used')??0;if(used>=4)return{allowed:false};await tx.put('backup-used',used+1);return{allowed:true};}
        if(op==='experiment-restore'){
          const state=body.state as ExperimentState;const existing=await tx.get<ExperimentState>('state');if(existing&&JSON.stringify(existing)!==JSON.stringify(state))throw new HttpError(409,'restored state differs');await tx.put('state',state);return{restored:true};
        }
        if(op==='native-restore'){
          const entry=entrySchema.parse(body.entry),parents=body.parents as string[],entries=await tx.get<NativeEntry[]>('native-entries')??[],publishers=await tx.get<Record<string,unknown>>('native-publishers')??{};
          const existing=entries[entry.sequence-1];if(existing){if(existing.content_hash!==entry.content_hash)throw new HttpError(409,'restored journal differs');return{restored:true};}
          if(entry.sequence!==entries.length+1||entry.previous!==(entries.at(-1)?.content_hash??null)||parents.some(p=>!entries.some(e=>e.version===p)))throw new HttpError(409,'restored ancestry differs');
          if(body.publisher)publishers[entry.version]=body.publisher;
          await tx.put('native-publishers',publishers);await tx.put('native-entries',[...entries,entry]);return{restored:true};
        }
        if(op==='native-verify-budget'){
          const used=await tx.get<number>('native-verifications-used')??0;
          if(used>=8)return{allowed:false};await tx.put('native-verifications-used',used+1);return{allowed:true};
        }
        if(op==='auth-attempt'){
          let budget=await tx.get<{count:number;until:number}>('auth-budget');
          if(!budget||budget.until<=Date.now())budget={count:0,until:Date.now()+600000};
          if(budget.count>=20)return{allowed:false};budget.count++;await tx.put('auth-budget',budget);return{allowed:true};
        }
        if(op==='native-refs'){const events=await tx.get<NativeRef[]>('native-ref-events')??[],heads=await tx.get<Record<string,string>>('native-ref-heads')??{};return{schema_version:1,events,heads,tip:events.at(-1)?.content_hash??null};}
        if(op==='native-ref-append'){
          const ref=refSchema.parse(body.ref),events=await tx.get<NativeRef[]>('native-ref-events')??[],heads=await tx.get<Record<string,string>>('native-ref-heads')??{},entries=await tx.get<NativeEntry[]>('native-entries')??[];
          const existing=events[ref.sequence-1];if(existing){if(existing.content_hash!==ref.content_hash)throw new HttpError(409,'native reference history diverges');return{ref:existing,retained:true};}
          if(events.length>=1024||ref.sequence!==events.length+1||ref.previous!==(events.at(-1)?.content_hash??null)||ref.expected!==(Object.hasOwn(heads,ref.branch)?heads[ref.branch]:null)||!entries.some(e=>e.version===ref.target))throw new HttpError(409,'branch expectation or reference history changed');
          heads[ref.branch]=ref.target;await tx.put('native-ref-events',[...events,ref]);await tx.put('native-ref-heads',heads);return{ref,retained:true};
        }
        if(op==='native-log'||op==='native-backup-authority'){
          const entries=await tx.get<NativeEntry[]>('native-entries')??[];
          const publishers=await tx.get<Record<string,{username:string;published_at:number}>>('native-publishers')??{};
          return {schema_version:1,backend:'ace-native-v1',entries,publishers,tip:entries.at(-1)?.content_hash??null,qualification:'caller_asserted_requires_ACE_verification',...(op==='native-backup-authority'?{refs:{schema_version:1,events:await tx.get<NativeRef[]>('native-ref-events')??[],heads:await tx.get<Record<string,string>>('native-ref-heads')??{},tip:(await tx.get<NativeRef[]>('native-ref-events'))?.at(-1)?.content_hash??null}}:{})};
        }
        if(op==='native-append'){
          const entry=entrySchema.parse(body.entry),parents=body.parents as string[];
          const entries=await tx.get<NativeEntry[]>('native-entries')??[];
          const existing=entries[entry.sequence-1];
          if(existing){if(existing.content_hash!==entry.content_hash)throw new HttpError(409,'native remote history diverges; choose a fresh store name');return {entry:existing,retained:true};}
          if(entries.length>=256||entry.sequence!==entries.length+1||entry.previous!==(entries.at(-1)?.content_hash??null)
            ||entries.some(e=>e.version===entry.version)||!Array.isArray(parents)||parents.some(p=>!entries.some(e=>e.version===p)))throw new HttpError(409,'native journal sequence or ancestry does not extend the current history');
          const publishers=await tx.get<Record<string,{username:string;published_at:number}>>('native-publishers')??{};
          publishers[entry.version]={username:String(body.publisher).slice(0,64),published_at:Date.now()};
          await tx.put('native-publishers',publishers);await tx.put('native-entries',[...entries,entry]);return {entry,retained:true};
        }
        // Separate daily DO names hold advisory inference reservations, never
        // candidate evaluation state. Each actual provider attempt spends a slot.
        if (op === 'judge-claim' || op === 'generator-claim') {
          const kind = op === 'judge-claim' ? 'judge' : 'generator';
          const key = `${kind}:${body.key}`;
          const previous = await tx.get<{ done?: boolean; token: string; leaseUntil: number }>(key);
          if (previous?.done) return { disposition: 'done' };
          if ((previous?.leaseUntil ?? 0) > Date.now()) return { disposition: 'busy' };
          const used = await tx.get<number>(`${kind}-used`) ?? 0;
          if (used >= (kind === 'judge' ? 64 : 16)) return { disposition: 'budget' };
          const token = crypto.randomUUID();
          await tx.put(`${kind}-used`, used + 1);
          await tx.put(key, { token, leaseUntil: Date.now() + 120_000 });
          return { disposition: 'claimed', token };
        }
        if (op === 'judge-complete' || op === 'generator-complete') {
          const kind = op === 'judge-complete' ? 'judge' : 'generator';
          const key = `${kind}:${body.key}`;
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

// Independent namespace prevents customer-chosen experiment IDs from colliding
// with disaster drills. No public route can write this namespace.
export class RestoreCoordinator extends ExperimentCoordinator {}
