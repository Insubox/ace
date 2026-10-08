// Deploy uploaded Worker versions; never uploads code or changes data/images.
import {parseArgs} from 'node:util';import {readPrivateState,writePrivateState} from './lib/private-state.mjs';
import {settings,api} from './client.mjs';import {rollout} from './lib/rollout.mjs';
import {requireServedVersion} from './lib/version-smoke.mjs';
import {checkReleasePlan} from './lib/release-plan.mjs';
const {values}=parseArgs({options:{before:{type:'string'},candidate:{type:'string'},worker:{type:'string'},output:{type:'string'},plan:{type:'string'},drill:{type:'boolean',default:false}}});
if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.worker??'')||!values.output)throw Error('Use --worker --before --candidate --output private-file [--drill]');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;if(!/^[a-f0-9]{32}$/.test(account??'')||!token)throw Error('Configure Cloudflare account and token privately');
const config=settings(),path=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${values.worker}/deployments`;
const provider=async init=>{const r=await fetch(path,{...init,headers:{authorization:'Bearer '+token,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||!data.success)throw Error('Cloudflare deployment request failed HTTP '+r.status);return data.result;};
const read=async()=>{const result=await provider({});const current=result.deployments?.[0];if(!current?.id||!Array.isArray(current.versions))throw Error('No current Worker deployment');return{id:current.id,versions:current.versions};};
if(!values.plan)throw Error('Use --plan with a private exact-source approved release plan');
const plan=await readPrivateState(values.plan);if(plan.worker!==values.worker||plan.before!==values.before||plan.candidate!==values.candidate)throw Error('Release plan differs from requested deployment');
const readVersion=async id=>{const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${values.worker}/versions/${id}`,{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)}),data=await r.json();if(!r.ok||!data.success)throw Error('Uploaded Worker identity unavailable');return data.result;};
let proof=await checkReleasePlan(plan,config,readVersion);
const deploy=async versions=>{if(versions.some(v=>v.version_id===values.candidate))proof=await checkReleasePlan(plan,config,readVersion);const r=await provider({method:'POST',body:JSON.stringify({strategy:'percentage',versions,annotations:{'workers/message':'ACE approved source '+proof.authorization.source_version}})});return{id:r.id,versions:r.versions};};
const smoke=async version=>{
 const headers={'Cloudflare-Workers-Version-Overrides':`${values.worker}="${version}"`};
 const r=await fetch(config.origin+'/',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});requireServedVersion(r,version);if(version===values.candidate&&(r.headers.get('x-ace-source-version')!==proof.authorization.source_version||r.headers.get('x-ace-source-hash')!==proof.authorization.source_hash))throw Error('Served source differs from release approval');if(!r.ok||!r.headers.get('content-security-policy')||(await r.text()).length<10000)throw Error('Observatory smoke check failed');
 const operation=await api(config,'/v1/operations',{headers,signal:AbortSignal.timeout(15000)});requireServedVersion(operation,version);const state=await operation.json();if(state.schema_version!==1||state.alerts.length)throw Error('Operations smoke check failed');return{served_worker_version:version,observatory:true,authenticated_operations:true,alerts:0,evaluator_binary_hash:state.evaluator_binary_hash};
};
try{const result=await rollout({before:values.before,candidate:values.candidate,read,deploy,smoke,drill:values.drill,record:e=>writePrivateState(values.output,e)});console.log(JSON.stringify(result));}catch{console.error('Rollout stopped; inspect the private evidence and current deployment before retrying.');process.exitCode=1;}
