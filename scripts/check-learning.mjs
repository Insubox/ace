// Offline controlled ablation: same two-proposal budget and fixed proposal pool.
// Demonstrates exact evidence reuse, not an LLM/generalization claim.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const {values}=parseArgs({options:{ace:{type:'string',default:'ace'},output:{type:'string'}}});
assert(values.output,'Choose a fresh --output directory');const root=resolve(values.output);await mkdir(root);
const ace=(...args)=>JSON.parse(execFileSync(values.ace,args,{encoding:'utf8',timeout:180000,maxBuffer:16777216}));
const wat=[
 '(module (func (export "gcd") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))',
 '(module (func (export "gcd") (param $a i32) (param $b i32) (result i32) (local $r i32) (block $done (loop $again local.get $b i32.eqz br_if $done local.get $a local.get $b i32.rem_u local.set $r local.get $b local.set $a local.get $r local.set $b br $again)) local.get $a))',
 '(module (func $g (export "gcd") (param $a i32) (param $b i32) (result i32) local.get $b i32.eqz (if (result i32) (then local.get $a) (else local.get $b local.get $a local.get $b i32.rem_u call $g))))'
];
const pool=wat.map((wat,index)=>({id:'C-pool-'+index,wat,strategy:['addition','iterative-remainders','recursive-remainders'][index],generator:{provider:'controlled-pool',model:'offline-fixture-v1'}}));
const store=join(root,'native');
async function register(name,candidates){const path=join(root,name+'.json');await writeFile(path,JSON.stringify({schema_version:1,cell:'Gcd',candidates}),{flag:'wx'});const directory=join(root,name+'-input');const registration=ace('propose',path,'--output',directory);return{directory,registration};}
async function execute(name,candidates){const {directory}=await register(name,candidates),run=join(root,name+'-run');ace('run',directory,'--output',run);const sealed=JSON.parse(await readFile(join(run,'run.json'),'utf8'));const retained=ace('store','save',run,'--store',store);return{run,sealed,version:retained.version};}
const training=await execute('training',[pool[0],pool[2]]),memory=ace('memory',store,'--baseline-run',training.run,'--limit','64');
assert.equal(memory.compatible_runs,1);assert.equal(memory.excluded_runs,0);
const failed=new Set(memory.observations.filter(o=>['failed_correctness','failed_contract','invalid_module','failed_resource_limit'].includes(o.outcome)).map(o=>o.artifact_hash));
const completePool=await register('pool',pool),hashes=new Map(completePool.registration.artifacts.map(a=>[a.candidate,a.artifact_hash]));
const learnedWinner=pool.find(p=>hashes.get(p.id)===memory.winner.artifact_hash);assert(learnedWinner,'Winner source must exist in the exact proposal pool');assert.equal(learnedWinner.wat,memory.winner.wat);
const informed=[learnedWinner,...pool.filter(p=>p!==learnedWinner&&!failed.has(hashes.get(p.id)))].slice(0,2);
assert.equal(informed.length,2);assert(informed.every(p=>!failed.has(hashes.get(p.id))));
const without=await execute('without-memory',pool.slice(0,2)),withMemory=await execute('with-memory',informed);
function measured(trial){const r=trial.sealed.report,candidates=r.results.filter(x=>!x.is_baseline),qualified=candidates.filter(x=>x.evaluation.outcome==='qualified');return{experiment:r.experiment.id,version:trial.version,report_hash:trial.sealed.content_hash,proposal_budget:2,evaluations:r.results.length,qualified_proposals:qualified.length,rejected_proposals:candidates.length-qualified.length,best_proposal_fuel:Math.min(...qualified.map(x=>x.evaluation.mean_fuel)),candidates:candidates.map(x=>({id:x.candidate.id,artifact:x.candidate.patch.hash,outcome:x.evaluation.outcome,evidence_hash:x.evidence.content_hash}))};}
const a=measured(without),b=measured(withMemory);assert.equal(without.sealed.report.environment_hash,withMemory.sealed.report.environment_hash);assert.equal(a.proposal_budget,b.proposal_budget);assert.equal(a.evaluations,b.evaluations);assert(b.qualified_proposals>a.qualified_proposals);assert(b.best_proposal_fuel<a.best_proposal_fuel);
ace('store','log',store);for(const trial of [training,without,withMemory]){const snapshot=join(store,'views',trial.version);const result=ace('cloud','verify-snapshot',snapshot,'--output',join(root,'replay-'+trial.version));assert.equal(result.status,'reproduced');}
const result={schema_version:1,scope:'Fixed proposal pool and explicit reuse policy; no claim about LLMs, novel-source generalization or other workloads',selection:'Prioritize the exact retained qualified winner and avoid exact artifacts with resolved negative evidence in the same context; evaluate every selected proposal again',environment:without.sealed.report.environment_hash,training:{report_hash:training.sealed.content_hash,version:training.version},known_negative_artifacts:[...failed],without_memory:a,with_memory:b,independent_replays:3,paid_model_calls:0,git_required:false};
await writeFile(join(root,'comparison.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
