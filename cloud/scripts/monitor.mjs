// Runs independently of ACE/Cloudflare. Alert delivery is opt-in configuration.
import {parseArgs} from 'node:util';
import {readPrivateState,writePrivateState} from './lib/private-state.mjs';
import {pathToFileURL} from 'node:url';
import {settings,api} from './client.mjs';
export async function observe(config,request=api){
 try{const response=await request(config,'/v1/operations',{signal:AbortSignal.timeout(15000)});const state=await response.json();if(state.schema_version!==1||!Array.isArray(state.alerts)||state.alerts.length>64||state.alerts.some(s=>typeof s!=='string'||! /^[a-z_0-9]{1,128}$/.test(s)))throw new Error('invalid observations');
  const input=state.observatory_budget;let budget=null;
  if(input){if(typeof input.day!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(input.day))throw new Error('invalid budget');budget={day:input.day};for(const key of ['trials_used','trials_limit','application_replays_used','application_replays_limit','containers_used','containers_limit']){if(!Number.isSafeInteger(input[key])||input[key]<0)throw new Error('invalid budget');budget[key]=input[key];}}
  return{schema_version:1,observed_at:Date.now(),alerts:[...new Set(state.alerts)],budget};}
 catch{return{schema_version:1,observed_at:Date.now(),alerts:['control_plane_unreachable_or_unauthorized'],budget:null};}
}
export async function notify(snapshot,previous,webhook,request=fetch){
 const signature=JSON.stringify([...snapshot.alerts].sort()),changed=signature!==previous?.signature,due=Date.now()-(previous?.sent_at??0)>=1800000;
 if(!webhook||(!changed&&!due)||(!snapshot.alerts.length&&!previous?.alerting))return previous??{};
 const url=new URL(webhook);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Webhook must use HTTPS');
 // No ACE credential, account/project identifiers, code or provider traces.
 const response=await request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:snapshot.alerts.length?'ace.operations.alert':'ace.operations.recovered',...snapshot}),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('External alert delivery failed');
 return{signature,sent_at:Date.now(),alerting:snapshot.alerts.length>0};
}
async function main(){const {values}=parseArgs({options:{watch:{type:'boolean',default:false},state:{type:'string',default:'.ace-monitor.json'},interval:{type:'string',default:'60'}}}),interval=Number(values.interval);if(!Number.isInteger(interval)||interval<30||interval>3600)throw new Error('Interval must be 30–3600 seconds');const config=settings();let previous;try{previous=await readPrivateState(values.state);}catch(error){if(error.code!=='ENOENT')throw new Error('Monitor state cannot be read');}
 do{const snapshot=await observe(config);console.log(JSON.stringify(snapshot));try{const next=await notify(snapshot,previous,process.env.ACE_ALERT_WEBHOOK_URL);if(next!==previous){await writePrivateState(values.state,next);previous=next;}}catch{console.error('External alert delivery failed; retry on next observation.');process.exitCode=1;}if(!values.watch){if(snapshot.alerts.length)process.exitCode=1;break;}await new Promise(resolve=>setTimeout(resolve,interval*1000));}while(true);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Monitor configuration failed.');process.exitCode=1;});
