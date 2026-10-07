import {submit} from './submission';
export {submit} from './submission';
import { z } from 'zod';
import { type Env, type ExperimentState, type FinalizeJob, HttpError, coordinate, planSchema, identifier, hash,
  strictJson, limitedBody, immutablePut, sha256, json } from './contracts';
import { consumeEvaluation, consumeFinalization, failExperiment } from './pipeline';
import { judge, readJudgement,judgementId,judgeContextSchema } from './judge';
import { generate, readGeneration,generationId,taskSchema, type Selector } from './generator';
import * as nativeStores from './native-store';
import dashboard from './dashboard.html';
import * as accounts from './accounts';
import * as projects from './projects';
import {readVerification,requestVerification,readVerifiedRun} from './verification';
import {requestBackup,listBackups,requestRestore,readDrill,readRestoreReceipt} from './backups';
import {requestTrial,listTrials,readTrial,readProposal,retryTrial} from './observatory';
export {ObservatoryWorkflow} from './observatory';
export {BackupWorkflow} from './backups';
export {NativeVerificationWorkflow} from './verification';
export { ExperimentCoordinator,RestoreCoordinator } from './coordinator';
export { EvaluationSandbox } from './sandbox';
export { ExperimentWorkflow } from './workflow';

async function status(env: Env, id: string): Promise<ExperimentState> {
  identifier.parse(id); return await coordinate(env, id, 'status') as ExperimentState;
}
async function report(env: Env, id: string): Promise<Record<string, unknown>> {
  const state = await status(env, id);
  if (state.status !== 'completed' || !state.reportKey) throw new HttpError(409, 'experiment has no completed report');
  const object = await env.ARTIFACTS.get(state.reportKey);
  if (!object) throw new HttpError(503, 'completed report missing');
  const bytes = await object.arrayBuffer();
  if (await sha256(bytes) !== state.finalizer.resultHash) throw new HttpError(503, 'completed report corrupted');
  return (JSON.parse(new TextDecoder().decode(bytes)) as { report: Record<string, unknown> }).report;
}
function publicStatus(state: ExperimentState): unknown {
  return { experiment: state.experiment, project: state.project, status: state.status, total: state.count,
    completed: state.completed, deadline: state.deadline, error: state.error ?? null };
}
async function inspect(env: Env, id: string, kind: string, candidate: string|undefined, actor:accounts.Identity): Promise<unknown> {
  await projects.resource(env,actor,'experiment',id);
  if (kind === 'status') return publicStatus(await status(env, id));
  const r = await report(env, id);
  if (kind === 'run') return r;
  if (kind === 'champion' && !r.champion) throw new HttpError(409, 'no Champion: baseline did not qualify');
  if (kind === 'champion' || kind === 'knowledge') return { schema_version: 1, payload: { kind, data: r[kind] } };
  identifier.parse(candidate);
  const result = (r.results as { candidate: { id: string }; evidence: unknown }[]).find(result => result.candidate.id === candidate);
  if (!result) throw new HttpError(404, 'candidate not registered');
  return kind === 'evidence' ? { schema_version: 1, payload: { kind: 'evidence', data: result.evidence } } : result;
}
const tools = [
  { name: 'ace_status', description: 'Read experiment status and completed task count.' },
  { name: 'ace_champion', description: 'Read the locally scoped qualified Champion from a completed distributed experiment.' },
  { name: 'ace_knowledge', description: 'Read evidence-backed knowledge from a completed experiment.' },
  { name: 'ace_explain', description: 'Read measured evaluation and Rust policy decision for a registered candidate.' }
].map(t => ({ ...t, inputSchema: { type: 'object', properties: { experiment: { type: 'string' }, ...(t.name === 'ace_explain' ? { candidate: { type: 'string' } } : {}) },
  required: t.name === 'ace_explain' ? ['experiment', 'candidate'] : ['experiment'], additionalProperties: false } }));
async function mcp(request: Request, env: Env, actor:accounts.Identity): Promise<Response> {
  const body = z.strictObject({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string(), params: z.unknown().optional() }).parse(strictJson(new TextDecoder().decode(await limitedBody(request, 16_384))));
  if (body.id === undefined) {
    if (body.method === 'notifications/initialized') return new Response(null, { status: 204 });
    return new Response(null, { status: 202 });
  }
  const reply = (result: unknown) => json({ jsonrpc: '2.0', id: body.id, result });
  if (body.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'ace', version: '0.3.0' } });
  if (body.method === 'ping') return reply({});
  if (body.method === 'tools/list') return reply({ tools });
  if (body.method === 'tools/call') {
    try {
      const { name, arguments: args } = z.strictObject({ name: z.enum(['ace_status', 'ace_champion', 'ace_knowledge', 'ace_explain']),
        arguments: z.strictObject({ experiment: identifier, candidate: identifier.optional() }) }).parse(body.params);
      const value = await inspect(env, args.experiment, name.slice(4), args.candidate, actor);
      return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
    } catch (e) { return reply({ content: [{ type: 'text', text: e instanceof HttpError ? e.message : 'invalid tool arguments' }], isError: true }); }
  }
  return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if(request.method==='GET'&&['/','/setup','/recover'].includes(new URL(request.url).pathname))return new Response(dashboard,{headers:{'content-type':'text/html; charset=utf-8',
        'content-security-policy':"default-src 'none'; script-src 'nonce-ace-native-dashboard-v1'; style-src 'nonce-ace-native-dashboard-v1'; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
      const url = new URL(request.url);
      if(url.pathname==='/v1/auth/setup'&&request.method==='POST')return await accounts.setup(env,await limitedBody(request,16384));
      if(url.pathname==='/v1/auth/login'&&request.method==='POST')return await accounts.login(request,env,await limitedBody(request,16384));
      if(url.pathname==='/v1/auth/recover'&&request.method==='POST')return await accounts.recover(request,env,await limitedBody(request,16384));
      const current=await accounts.identity(request,env);accounts.authorize(request,current);
      if(url.pathname==='/v1/auth/me'&&request.method==='GET')return json(current);
      if(url.pathname==='/v1/auth/setup-ticket'&&request.method==='POST')return await accounts.setupTicket(env,current);
      if(url.pathname==='/v1/auth/logout'&&request.method==='POST')return await accounts.logout(request,env,current);
      if(url.pathname==='/v1/users'&&request.method==='POST')return await accounts.createUser(env,current,await limitedBody(request,16384));
      if(url.pathname==='/v1/auth/audit'&&request.method==='GET')return await accounts.audit(env,current);
      const recovery=/^\/v1\/users\/([a-z0-9][a-z0-9_-]{2,31})\/recovery$/.exec(url.pathname);
      if(recovery&&request.method==='POST')return await accounts.recoveryTicket(env,current,recovery[1]!);
      if(url.pathname==='/v1/users'&&request.method==='GET')return await accounts.users(env,current);
      if(url.pathname==='/v1/backups'&&request.method==='GET')return await listBackups(env,current);
      if(url.pathname==='/v1/backups'&&request.method==='POST'){if((await limitedBody(request,1)).length)throw new HttpError(400,'backup takes no payload');return await requestBackup(env,current);}
      const restoration=/^\/v1\/backups\/(backup-(?:[0-9]{8}|[0-9a-f-]{36}))\/restore(?:\/stores\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/(objects|versions)\/([0-9a-f]{64})|\/(refs))?)?$/.exec(url.pathname);
      if(restoration){if(request.method==='GET'&&!restoration[2])return await readRestoreReceipt(env,current,restoration[1]!);if(request.method==='POST'&&!restoration[2])return await requestRestore(env,current,restoration[1]!);if(request.method==='GET'&&restoration[2])return await readDrill(env,current,restoration[1]!,restoration[2],restoration[3]??restoration[5],restoration[4]);}
      if(url.pathname==='/v1/projects'&&request.method==='GET')return await projects.list(env,current);
      if(url.pathname==='/v1/projects'&&request.method==='POST')return await projects.create(env,current,await limitedBody(request,8192));
      const trials=/^\/v1\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/trials(?:\/(trial-[0-9a-f]{64})(\/(?:proposal|retry))?)?$/.exec(url.pathname);
      if(trials){if(request.method==='GET'&&trials[3]!=='/retry')return trials[2]?(trials[3]?await readProposal(env,current,trials[1]!,trials[2]):await readTrial(env,current,trials[1]!,trials[2])):await listTrials(env,current,trials[1]!);if(request.method==='POST'&&!trials[2])return await requestTrial(env,current,trials[1]!,await limitedBody(request,65536));if(request.method==='POST'&&trials[2]&&trials[3]==='/retry'){if((await limitedBody(request,1)).length)throw new HttpError(400,'retry accepts no replacement source');return await retryTrial(env,current,trials[1]!,trials[2]);}}
      const project=/^\/v1\/projects\/([^/]+)\/(members|audit)(?:\/([a-z0-9][a-z0-9_-]{2,31}))?$/.exec(url.pathname);
      if(project){const name=identifier.parse(project[1]);if(project[2]==='audit'&&request.method==='GET')return await projects.history(env,current,name);
        if(project[2]==='members'){if(request.method==='GET')return await projects.members(env,current,name);if(request.method==='POST')return await projects.grant(env,current,name,await limitedBody(request,8192));if(request.method==='DELETE'&&project[3])return await projects.revoke(env,current,name,project[3]);}}
      if(url.pathname==='/v1/stores'&&request.method==='GET')return await projects.listStores(env,current);
      const check=/^\/v1\/stores\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/versions\/([0-9a-f]{64})\/(verification(?:\/run)?|verify)$/.exec(url.pathname);
      if(check){await projects.access(env,current,check[1]!,request.method==='GET'?'read':'write');if(request.method==='GET'&&check[3]==='verification/run')return await readVerifiedRun(env,check[1]!,check[2]!);if(request.method==='GET'&&check[3]==='verification')return await readVerification(env,check[1]!,check[2]!);if(request.method==='POST'&&check[3]==='verify'){if((await limitedBody(request,1)).length)throw new HttpError(400,'verification does not accept caller-supplied results');const result=await requestVerification(env,check[1]!,check[2]!);await projects.audit(env,current,check[1]!,'verification.request',check[2]!);return result;}}
      const refs=/^\/v1\/stores\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/refs$/.exec(url.pathname);
      if(refs){await projects.access(env,current,refs[1]!,request.method==='GET'?'read':'write');if(request.method==='GET')return await nativeStores.readRefs(env,refs[1]!);if(request.method==='POST'){const response=await nativeStores.appendRef(env,refs[1]!,await limitedBody(request,8192));const value=await response.clone().json() as {ref:{content_hash:string}};await projects.audit(env,current,refs[1]!,'branch.advance',value.ref.content_hash,'reference-'+value.ref.content_hash);return response;}}
      const native=/^\/v1\/stores\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/(objects|versions)\/([0-9a-f]{64})|\/(journal))?$/.exec(url.pathname);
      if(native){if(request.method==='PUT')await projects.ensure(env,current,native[1]!);else await projects.access(env,current,native[1]!,request.method==='GET'?'read':'write');const name=native[1]!,kind=native[2] as 'objects'|'versions'|undefined,id=native[3];
        if(request.method==='GET'){if(kind&&id)return await nativeStores.readFile(env,name,kind,id);if(!native[4])return await nativeStores.readStore(env,name);}
        if(request.method==='PUT'&&kind&&id){const bytes=await limitedBody(request,kind==='objects'?8388608:1048576);return kind==='objects'?await nativeStores.putObject(env,name,id,bytes):await nativeStores.putVersion(env,name,id,bytes);}
        if(request.method==='POST'&&native[4]){const result=await nativeStores.appendEntry(env,name,await limitedBody(request,8192),current.username);const data=await result.clone().json() as {entry:{content_hash:string}};await projects.audit(env,current,name,'version.publish',data.entry.content_hash,'publication-'+data.entry.content_hash);return result;}
      }
      if (url.pathname === '/mcp' && request.method === 'POST') return await mcp(request, env,current);
      const generationRoute = /^\/v1\/generate\/(qwen|llama)$/.exec(url.pathname);
      if (generationRoute && request.method === 'POST'){const bytes=await limitedBody(request,98304),project=projects.selected(request,current);taskSchema.parse(strictJson(new TextDecoder().decode(bytes)));await projects.reserveModel(env,current,'generation',await generationId(bytes,generationRoute[1] as Selector),project);const result=await generate(env,bytes,generationRoute[1] as Selector),metadata=await result.clone().json() as {generation:string};await projects.claim(env,current,'generation',metadata.generation,project);await projects.audit(env,current,project,'generation.request',metadata.generation);return result;}
      const generation = /^\/v1\/generations\/([0-9a-f]{64})(?:\/(context|request|response|attempt))?$/.exec(url.pathname);
      if (generation && request.method === 'GET'){await projects.resource(env,current,'generation',generation[1]!);return await readGeneration(env,generation[1]!,generation[2]);}
      const judgeRoute = /^\/v1\/judge\/(flash|clef)$/.exec(url.pathname);
      if (judgeRoute && request.method === 'POST'){const bytes=await limitedBody(request,32768),context=judgeContextSchema.parse(strictJson(new TextDecoder().decode(bytes)));await projects.resource(env,current,'experiment',context.experiment);for(const failure of context.known_failures??[])await projects.resource(env,current,'experiment',failure.experiment);const project=projects.selected(request,current);await projects.reserveModel(env,current,'judgement',await judgementId(bytes,judgeRoute[1] as 'flash'|'clef'),project);const result=await judge(env,bytes,judgeRoute[1] as 'flash'|'clef'),metadata=await result.clone().json() as {judgement:string};await projects.claim(env,current,'judgement',metadata.judgement,project);await projects.audit(env,current,project,'judge.request',metadata.judgement);return result;}
      const judgement = /^\/v1\/judgements\/([0-9a-f]{64})(?:\/(context|request|response|attempt))?$/.exec(url.pathname);
      if (judgement && request.method === 'GET'){await projects.resource(env,current,'judgement',judgement[1]!);return await readJudgement(env,judgement[1]!,judgement[2]);}
      const artifact = /^\/v1\/artifacts\/([0-9a-f]{64})$/.exec(url.pathname);
      if (artifact && request.method === 'PUT') {
        const project=projects.selected(request,current);await projects.ensure(env,current,project);
        const bytes = await limitedBody(request, 1_048_576);
        if (await sha256(bytes) !== artifact[1]) throw new HttpError(400, 'artifact hash mismatch');
        await immutablePut(env.ARTIFACTS, `artifacts/${artifact[1]}.wasm`, bytes);await projects.attachArtifact(env,current,artifact[1]!,project);return json({ hash: artifact[1] }, 201);
      }
      if (artifact && request.method === 'GET') {
        await projects.artifact(env,current,artifact[1]!);
        const object = await env.ARTIFACTS.get(`artifacts/${artifact[1]}.wasm`);
        if (!object) throw new HttpError(404, 'artifact not found');
        return new Response(object.body, { headers: { 'content-type': 'application/wasm' } });
      }
      if (url.pathname === '/v1/experiments' && request.method === 'POST'){const bytes=await limitedBody(request,131072),plan=planSchema.parse(strictJson(new TextDecoder().decode(bytes))),project=projects.selected(request,current,plan.config.project);if(plan.config.experiment.startsWith('EXP-OBS-'))throw new HttpError(400,'Observatory experiment identifiers are reserved');await projects.claim(env,current,'experiment',plan.config.experiment,project);for(const id of plan.module_hashes)await projects.artifact(env,current,id,project);const result=await submit(env,bytes);await projects.audit(env,current,project,'experiment.submit',plan.config.experiment);return result;}
      const route = /^\/v1\/experiments\/([^/]+)(?:\/(run|champion|knowledge|explain|evidence)(?:\/([^/]+))?)?$/.exec(url.pathname);
      if (route && request.method === 'GET') return json(await inspect(env, route[1]!, route[2] ?? 'status', route[3],current));
      const file = /^\/v1\/experiments\/([^/]+)\/files\/(.+)$/.exec(url.pathname);
      if (file && request.method === 'GET') {
        await projects.resource(env,current,'experiment',file[1]!);
        const state = await status(env, file[1]!); await report(env, file[1]!);
        if (!/^(?:run|environment|intent|experiment|knowledge|champion|baseline-champion)\.json$|^candidates\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/(?:candidate|evaluation|evidence|decision)\.json$/.test(file[2]!)) throw new HttpError(404, 'file not found');
        const prefix = state.reportKey!.slice(0, -'run.json'.length);
        const object = await env.ARTIFACTS.get(prefix + file[2]);
        if (!object) throw new HttpError(404, 'file not found');
        return new Response(object.body, { headers: { 'content-type': 'application/json' } });
      }
      throw new HttpError(404, 'route not found');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof z.ZodError) return json({ error: 'invalid request', issues: e.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
      // Internal SDK errors can contain request headers: keep responses/logs generic.
      return json({ error: 'control plane operation failed; retry the same request' }, 503);
    }
  },
  async scheduled(event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(requestBackup(env,{username:'operator',kind:'operator',role:'admin'},'backup-'+new Date(event.scheduledTime).toISOString().slice(0,10).replaceAll('-','')));},
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        let result: 'ack' | 'retry';
        if (batch.queue === 'ace-evaluations') result = await consumeEvaluation(env, message.body);
        else if (batch.queue === 'ace-finalizations') result = await consumeFinalization(env, message.body as FinalizeJob);
        else if (batch.queue === 'ace-dead') {
          const job = z.object({ experiment: identifier, planHash: hash }).parse(message.body);
          await failExperiment(env, job, 'queue exhausted delivery retries; no candidate correctness conclusion'); result = 'ack';
        } else throw new Error('unknown queue');
        if (result === 'retry') message.retry({ delaySeconds: 60 }); else message.ack();
      } catch (e) {
        if (e instanceof z.ZodError) message.ack(); // malformed internal message has no registered identity
        else message.retry({ delaySeconds: 60 });
      }
    }
  }
} satisfies ExportedHandler<Env>;
