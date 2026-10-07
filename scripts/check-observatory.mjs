// --request authorizes exactly one bounded manual trial. Default is read only.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {settings,api} from '../cloud/scripts/client.mjs';
import {pullStore} from '../cloud/scripts/store-sync-driver.mjs';
const {values}=parseArgs({options:{request:{type:'boolean',default:false},wait:{type:'boolean',default:false},project:{type:'string',default:'observatory-v04'},id:{type:'string'},kind:{type:'string',default:'euclid'},cell:{type:'string',default:'Gcd'},output:{type:'string'},ace:{type:'string',default:'ace'}}});
assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.project));assert(['euclid','addition'].includes(values.kind));assert(['Gcd','MaxU32','MinU32'].includes(values.cell));assert(!values.request||!values.id);
const config=settings(),path=`/v1/projects/${values.project}/trials`;let id=values.id;
if(values.request){await api(config,'/v1/projects',{method:'POST',body:JSON.stringify({name:values.project})});
 const wat=values.cell!=='Gcd'?`(module (func (export "${values.cell==='MaxU32'?'max_u32':'min_u32'}") (param $a i32) (param $b i32) (result i32) local.get $a local.get $b local.get $a local.get $b i32.${values.cell==='MaxU32'?'gt':'lt'}_${values.kind==='addition'?'s':'u'} select))`:values.kind==='euclid'?'(module (func (export "gcd") (param $a i32) (param $b i32) (result i32) (local $r i32) (block $done (loop $again local.get $b i32.eqz br_if $done local.get $a local.get $b i32.rem_u local.set $r local.get $b local.set $a local.get $r local.set $b br $again)) local.get $a))':'(module (func (export "gcd") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))';
 const request={request_id:randomUUID(),cell:values.cell,wat,strategy:values.cell!=='Gcd'?`Compare ${values.kind==='addition'?'incorrect signed':'unsigned'} selection with the ${values.cell} reference`:values.kind==='euclid'?'Compare Euclidean remainders with the bounded divisor reference':'Retain a rejected addition proposal against the GCD oracle'};
 const result=await(await api(config,path,{method:'POST',body:JSON.stringify(request)})).json();id=result.id;console.log(JSON.stringify({trial:id,experiment:result.experiment,requested:true}));
 const retry=await(await api(config,path,{method:'POST',body:JSON.stringify(request)})).json();assert.equal(retry.id,id,'HTTP retries must preserve identity');
}
if(!id){const result=await(await api(config,path)).json();id=result.trials.find(t=>t.status==='completed')?.id;assert(id,'No completed trial; use --request explicitly');}
let trial;
for(let i=0;i<720;i++){trial=await(await api(config,path+'/'+id)).json();if(trial.status==='failed')throw new Error(trial.error);if(trial.status==='completed')break;if(!values.request&&!values.wait)throw new Error('Trial is pending; use --wait');if(i%12===0)console.log(JSON.stringify({trial:id,status:trial.status,evaluation:trial.evaluation}));await new Promise(done=>setTimeout(done,2500));}
assert.equal(trial.status,'completed');assert(trial.native_version);const source=await(await api(config,path+'/'+id+'/proposal')).json();let summary=null;
if(values.output){const root=resolve(values.output);await mkdir(root);const directory=join(root,'native');await pullStore({directory,name:values.project,config,binary:values.ace});
 const snapshot=join(directory,'views',trial.native_version),run=JSON.parse(await readFile(join(snapshot,'run/run.json'),'utf8')).report;
 assert.equal(run.experiment.id,trial.experiment);assert.equal(run.config.project,values.project);assert.equal(run.config.cell,values.cell);assert.equal(await readFile(join(snapshot,'run/sources/C-proposal.wat'),'utf8'),source.wat);
 assert.equal(run.results.length,2);const proposal=run.results.find(r=>r.candidate.id==='C-proposal');assert(proposal);assert.equal(proposal.evaluation.outcome,values.kind==='addition'?'failed_correctness':'qualified');
 const replay=JSON.parse(execFileSync(values.ace,['cloud','verify-snapshot',snapshot,'--output',join(root,'replayed')],{encoding:'utf8',timeout:180000,maxBuffer:16777216}));assert.equal(replay.status,'reproduced');
 const baseline=run.results.find(r=>r.is_baseline),winner=run.champion?run.results.find(r=>r.candidate.id===run.champion.candidate):null;summary={proposal_outcome:proposal.evaluation.outcome,baseline_fuel:baseline.evaluation.mean_fuel,proposal_fuel:proposal.evaluation.mean_fuel,champion:winner?.candidate.id,replay_status:replay.status,source_retained:true,all_evidence_retained:true};
 await writeFile(join(root,'validation.json'),JSON.stringify({trial,summary},null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({trial:id,status:trial.status,version:trial.native_version,summary}));
