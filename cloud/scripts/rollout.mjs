// Deploy uploaded Worker versions; never uploads code or changes data/images.
import {parseArgs} from 'node:util';import {writePrivateState} from './lib/private-state.mjs';
import {settings,api} from './client.mjs';import {rollout} from './lib/rollout.mjs';
const {values}=parseArgs({options:{before:{type:'string'},candidate:{type:'string'},worker:{type:'string'},output:{type:'string'},drill:{type:'boolean',default:false}}});
if(!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.worker??'')||!values.output)throw Error('Use --worker --before --candidate --output private-file [--drill]');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;if(!/^[a-f0-9]{32}$/.test(account??'')||!token)throw Error('Configure Cloudflare account and token privately');
const config=settings(),path=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${values.worker}/deployments`;
const provider=async init=>{const r=await fetch(path,{...init,headers:{authorization:'Bearer '+token,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||!data.success)throw Error('Cloudflare deployment request failed HTTP '+r.status);return data.result;};
const read=async()=>{const result=await provider({});const current=result.deployments?.[0];if(!current?.id||!Array.isArray(current.versions))throw Error('No current Worker deployment');return{id:current.id,versions:current.versions};};
const deploy=async versions=>{const r=await provider({method:'POST',body:JSON.stringify({strategy:'percentage',versions,annotations:{'workers/message':'ACE checked gradual release'}})});return{id:r.id,versions:r.versions};};
const smoke=async version=>{
 const headers={'Cloudflare-Workers-Version-Overrides':`${values.worker}="${version}"`};
 const r=await fetch(config.origin+'/',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok||!r.headers.get('content-security-policy')||(await r.text()).length<10000)throw Error('Observatory smoke check failed');
 const state=await(await api(config,'/v1/operations',{headers,signal:AbortSignal.timeout(15000)})).json();if(state.schema_version!==1||state.alerts.length)throw Error('Operations smoke check failed');return{observatory:true,authenticated_operations:true,alerts:0,evaluator_binary_hash:state.evaluator_binary_hash};
};
try{const result=await rollout({before:values.before,candidate:values.candidate,read,deploy,smoke,drill:values.drill,record:e=>writePrivateState(values.output,e)});console.log(JSON.stringify(result));}catch{console.error('Rollout stopped; inspect the private evidence and current deployment before retrying.');process.exitCode=1;}
