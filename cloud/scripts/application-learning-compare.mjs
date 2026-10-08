// Paired, bounded real-model campaigns. --run explicitly admits two calls and
// at most two containers. Resume the same private state after interruption.
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readPrivateState,writePrivateState} from './lib/private-state.mjs';
import {settings,api} from './client.mjs';
const {values}=parseArgs({options:{project:{type:'string'},baseline:{type:'string'},model:{type:'string',default:'qwen'},state:{type:'string'},run:{type:'boolean',default:false}}});
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.project??'')||!/^app-[a-f0-9]{64}$/.test(values.baseline??'')||!['qwen','llama'].includes(values.model)||!values.state)throw Error('Use --project --baseline --model qwen|llama --state private-file [--run]');
const config=settings(),base=`/v1/projects/${values.project}`,args={project:values.project,baseline:values.baseline,model:values.model};
let state;
try{state=await readPrivateState(values.state);if(state.schema_version!==1||JSON.stringify(state.args)!==JSON.stringify(args))throw Error('Comparison arguments differ from saved state');}
catch(error){if(error.code!=='ENOENT')throw error;state={schema_version:1,args,arms:[{mode:'contract_only',request_id:randomUUID()},{mode:'outcomes',request_id:randomUUID()}]};await writePrivateState(values.state,state,{create:true});}
const save=()=>writePrivateState(values.state,state);
if(!Array.isArray(state.arms)||state.arms.length!==2||state.arms.some((a,i)=>a.mode!==['contract_only','outcomes'][i]||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.request_id)||a.campaign&&! /^campaign-[a-f0-9]{64}$/.test(a.campaign)))throw Error('Comparison arms differ from the saved experiment');
try{
 const baseline=await(await api(config,base+'/applications/'+values.baseline)).json();
 const listing=await(await api(config,base+'/applications')).json();
 if(!baseline.report||!['failed','passed'].includes(baseline.status)||baseline.report.image_hash!==listing.evaluator_image_hash)throw Error('Baseline needs an exact-source replay on the current evaluator before comparison');
 if(baseline.status==='passed')throw Error('Use an unfinished task; a passing baseline runs no model');
 for(const arm of state.arms){
  if(!arm.campaign){if(!values.run)continue;
   const result=await(await api(config,base+'/application-campaigns',{method:'POST',body:JSON.stringify({request_id:arm.request_id,baseline_run:values.baseline,model:values.model,rounds:1,patience:1,branch:null,learning_mode:arm.mode})})).json();arm.campaign=result.id;await save();}
  if(arm.campaign){const result=await(await api(config,base+'/application-campaigns/'+arm.campaign)).json();if(result.baseline_run!==values.baseline)throw Error('Campaign baseline differs');arm.status=result.status;arm.best_passed=result.state.best_passed;arm.total=result.state.total;arm.rounds=result.state.rounds;arm.summary_version=result.state.summary_version??null;}
 }
 state.baseline={run:values.baseline,source_hash:baseline.report.source_hash,suite_hash:baseline.report.suite_hash,image_hash:baseline.report.image_hash,passed:baseline.report.passed,total:baseline.report.total};
 const complete=state.arms.every(a=>a.status==='completed'&&a.rounds?.length===1&&a.rounds[0].run&&!a.rounds[0].fault);
 state.result={complete,observed_gain_difference:complete?state.arms[1].best_passed-state.arms[0].best_passed:null,scope:'One pair using the same baseline, model, contract, evaluator and generation settings. Measures observed public-suite gain only; stochastic model output and one pair do not establish a causal or general learning benefit. Neither arm promotes a branch.'};
 await save();console.log(JSON.stringify(state.result));
}catch(error){console.error(error.message);process.exitCode=1;}
