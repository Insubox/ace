import {loadAppSource,type AppJob} from './applications';
import {cases,executor,checkCase,type AppCase,type AppReport} from './application-profiles';
import {nativeHash} from './native-store';
import {loadVersion} from './native-store';
import { DurableObject } from 'cloudflare:workers';
import { Files } from '@cloudflare/sandbox';
import { type Env, type Job, type FinalizeJob, type CloudPlan, type ExperimentState,sha256,coordinate,immutablePut } from './contracts';
import type {TrialJob,NativeBundle} from './observatory';

export type RunFile = { path: string; content: string };
export class EvaluationSandbox extends DurableObject<Env> {
  private async writePrepared(files:Files,job:TrialJob,signal:AbortSignal){
    const prefix=`observatory/${job.id}/prepared/`;
    const planObject=await this.env.ARTIFACTS.get(prefix+'plan.json');if(!planObject)throw new Error('trusted prepared plan missing');const plan=await planObject.json<CloudPlan>();
    const names=['plan.json','experiment.json','registration.json','proposals.json',...['C-baseline','C-proposal'].map(id=>`sources/${id}.wat`)];
    await files.mkdir('/workspace/prepared',{recursive:true,signal});await files.mkdir('/workspace/prepared/sources',{recursive:true,signal});await files.mkdir('/workspace/prepared/artifacts',{recursive:true,signal});
    for(const name of names){const object=await this.env.ARTIFACTS.get(prefix+name);if(!object||object.size>131072)throw new Error('trusted prepared metadata missing');await files.writeFile('/workspace/prepared/'+name,object.body,{signal});}
    for(const hash of new Set(plan.module_hashes)){const object=await this.env.ARTIFACTS.get(`artifacts/${hash}.wasm`);if(!object||object.size>1048576)throw new Error('trusted compiled module missing');const bytes=await object.arrayBuffer();if(await sha256(bytes)!==hash)throw new Error('trusted compiled module corrupted');await files.writeFile(`/workspace/prepared/artifacts/${hash}.wasm`,bytes,{signal});}
    return plan;
  }
  async prepareTrial(job:TrialJob):Promise<{planHash:string}>{
    const object=await this.env.ARTIFACTS.get(job.requestKey);if(!object||object.size>65536)throw new Error('trial request missing');const request=await object.arrayBuffer();if(await sha256(request)!==job.requestHash)throw new Error('trial request changed');
    return this.withContainer(async(files,container,signal)=>{
      await files.writeFile('/workspace/request.json',request,{signal});
      const process=await container.exec(['/usr/local/bin/ace','cloud','prepare-trial','/workspace/request.json','--output','/workspace/prepared'],{signal});if((await process.output()).exitCode!==0)throw new Error('proposal assembly failed');
      const planFile=await files.readFile('/workspace/prepared/plan.json',{signal}),planBytes=await planFile.arrayBuffer(),plan=JSON.parse(new TextDecoder().decode(planBytes)) as CloudPlan;
      const prefix=`observatory/${job.id}/prepared/`;
      for(const name of ['experiment.json','registration.json','proposals.json','sources/C-baseline.wat','sources/C-proposal.wat']){const file=await files.readFile('/workspace/prepared/'+name,{signal});await immutablePut(this.env.ARTIFACTS,prefix+name,new Uint8Array(await file.arrayBuffer()));}
      for(const hash of new Set(plan.module_hashes)){const file=await files.readFile(`/workspace/prepared/artifacts/${hash}.wasm`,{signal});const bytes=new Uint8Array(await file.arrayBuffer());if(await sha256(bytes)!==hash)throw new Error('assembled module differs');await immutablePut(this.env.ARTIFACTS,`artifacts/${hash}.wasm`,bytes);}
      await immutablePut(this.env.ARTIFACTS,prefix+'plan.json',new Uint8Array(planBytes));return{planHash:await sha256(planBytes)};
    });
  }
  async archiveTrial(job:TrialJob):Promise<NativeBundle>{
    const state=await coordinate(this.env,job.experiment,'status') as ExperimentState;if(state.status!=='completed'||!state.reportKey)throw new Error('trial evaluation not completed');
    return this.withContainer(async(files,container,signal)=>{
      const plan=await this.writePrepared(files,job,signal);if(plan.config.experiment!==job.experiment||plan.config.project!==job.project)throw new Error('archive plan scope differs');
      await files.mkdir('/workspace/run',{recursive:true,signal});await files.mkdir('/workspace/run/artifacts',{recursive:true,signal});
      // load_report verifies every evaluated artifact before source archival.
      for(const hash of new Set(plan.module_hashes)){const module=await files.readFile(`/workspace/prepared/artifacts/${hash}.wasm`,{signal});await files.writeFile(`/workspace/run/artifacts/${hash}.wasm`,await module.arrayBuffer(),{signal});}
      const prefix=state.reportKey!.slice(0,-'run.json'.length);
      const names=['run.json','environment.json','intent.json','experiment.json','knowledge.json'];
      const reportObject=await this.env.ARTIFACTS.get(state.reportKey!);if(!reportObject)throw new Error('trusted report missing');const bytes=await reportObject.arrayBuffer();if(await sha256(bytes)!==state.finalizer.resultHash)throw new Error('trusted report corrupted');
      const report=JSON.parse(new TextDecoder().decode(bytes)) as {report:{champion?:{artifact:{hash:string}};baseline_champion?:unknown}};
      if(report.report.champion)names.push('champion.json');if(report.report.baseline_champion)names.push('baseline-champion.json');
      for(const id of [plan.config.baseline.id,...plan.config.candidates.map(c=>c.id)]){await files.mkdir('/workspace/run/candidates/'+id,{recursive:true,signal});for(const type of ['candidate','evaluation','evidence','decision'])names.push(`candidates/${id}/${type}.json`);}
      for(const name of names){const object=await this.env.ARTIFACTS.get(prefix+name);if(!object||object.size>3145728)throw new Error('trusted run file missing');await files.writeFile('/workspace/run/'+name,object.body,{signal});}
      if(report.report.champion){const object=await this.env.ARTIFACTS.get(`artifacts/${report.report.champion.artifact.hash}.wasm`);if(!object)throw new Error('champion module missing');await files.writeFile('/workspace/run/champion.wasm',object.body,{signal});}
      const process=await container.exec(['/usr/local/bin/ace','cloud','archive-trial','/workspace/run','--prepared','/workspace/prepared','--store','/workspace/native'],{signal});if((await process.output()).exitCode!==0)throw new Error('trusted trial source/evidence archival failed');
      const exported=await container.exec(['python3','/opt/ace/export_native.py'],{signal});if((await exported.output()).exitCode!==0)throw new Error('trusted native export failed');
      const bundle=await files.readFile('/workspace/native-bundle.json',{signal});return bundle.json<NativeBundle>();
    });
  }
  async testApplication(job:AppJob):Promise<AppReport>{
    const source=await loadAppSource(this.env,job),suite=cases[source.profile] as AppCase[];
    return this.withContainer(async(files,container,signal)=>{
      await files.mkdir('/workspace/app',{recursive:true,signal});for(const [path,text]of Object.entries(source.files))await files.writeFile('/workspace/app/'+path,text,{signal});
      const invoke=async(request:unknown)=>{const process=await container.exec(['python3','-I','-c',executor,JSON.stringify(request)],{signal});const out=await process.output();if(out.exitCode!==0||out.stdout.byteLength>24576)throw new Error('application broker failed');return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(out.stdout));};
      const compiled=await invoke({mode:'compile'}) as {compiled:boolean;runtime:string;errors:string[]};const results:AppReport['cases']=[];
      if(compiled.compiled)for(const test of suite){const observation=await invoke({mode:'run',input:test.input}) as {exit_code:number;timed_out:boolean;stdout:string;stderr:string};results.push(checkCase(test,observation));}
      for(const [path,text]of Object.entries(source.files)){const retained=await files.readFile('/workspace/app/'+path,{signal});if(await retained.text()!==text)throw new Error('application changed its retained source');}
      const passed=results.filter(c=>c.passed).length;return{schema_version:1,profile:source.profile,runtime:compiled.runtime,compiled:compiled.compiled,compile_errors:compiled.errors,status:compiled.compiled&&passed===suite.length?'passed':'failed',cases:results,passed,total:suite.length,source_hash:await nativeHash(source.files),suite_hash:await nativeHash(suite),image_hash:this.env.APPLICATION_IMAGE_HASH??null,scope:'Recorded public application suite, fixed Python standard-library dependencies, bounded child processes, fresh offline container. Passing does not qualify performance, prove all inputs or promote source.'};
    });
  }
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
  async verifyNative(store:string,version:string):Promise<{receipt:string;files:RunFile[]}>{
    const sealed=await loadVersion(this.env,store,version);
    if(sealed.version.kind.kind!=='evaluation')throw new Error('native version is not an evaluation');
    const entries=Object.entries(sealed.version.files);if(entries.length>768)throw new Error('native verification exceeds file budget');
    return this.withContainer(async(files,container,signal)=>{
      await files.mkdir('/workspace/snapshot',{recursive:true,signal});
      let total=0;
      for(const [path,id]of entries){
        const object=await this.env.ARTIFACTS.get(`native-stores/${store}/objects/${id}`);if(!object||object.size>8388608)throw new Error('native verification object missing or too large');
        total+=object.size;if(total>67108864)throw new Error('native verification exceeds byte budget');
        const bytes=await object.arrayBuffer();if(await sha256(bytes)!==id)throw new Error('native verification object corrupted');
        const parent=path.split('/').slice(0,-1).join('/');if(parent)await files.mkdir('/workspace/snapshot/'+parent,{recursive:true,signal});
        await files.writeFile('/workspace/snapshot/'+path,bytes,{signal});
      }
      const process=await container.exec(['/usr/local/bin/ace','cloud','verify-snapshot','/workspace/snapshot','--output','/workspace/verified'],{signal});
      if((await process.output()).exitCode!==0)throw new Error('trusted native verification could not finish');
      const receipt=await files.readFile('/workspace/verified/receipt.json',{signal});
      const exported=await container.exec(['python3','/opt/ace/export_run.py','/workspace/verified/run'],{signal});
      if((await exported.output()).exitCode!==0)throw new Error('verified run export failed');
      const bundle=await files.readFile('/workspace/bundle.json',{signal});
      return {receipt:await receipt.text(),files:await bundle.json<RunFile[]>()};
    });
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
