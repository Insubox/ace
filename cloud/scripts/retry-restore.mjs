// Operator-only recovery. Read-only by default; --run resumes one errored drill.
import {parseArgs} from 'node:util';
import {settings,api} from './client.mjs';
import {restoreRetryPlan} from './lib/restore-retry.mjs';
const {values}=parseArgs({options:{id:{type:'string'},run:{type:'boolean',default:false}}});
if(!values.id||!/^backup-(?:[0-9]{8}|[0-9a-f-]{36})$/.test(values.id))throw Error('Pass --id with an existing backup identity');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Configure Cloudflare operator credentials securely');
const c=settings(),id=values.id,workflow='restore-'+id;
const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workflows/ace-backups/instances/${workflow}`;
async function provider(path,init={}){
 const r=await fetch(url+path,{redirect:'error',signal:AbortSignal.timeout(30000),...init,
  headers:{authorization:'Bearer '+token,'content-type':'application/json',...init.headers}});
 if(!r.ok)throw Error('Cloudflare workflow request failed: HTTP '+r.status);
 const data=await r.json();if(!data.success||!data.result)throw Error('Cloudflare workflow operation failed');return data.result;
}
const backup=(await(await api(c,'/v1/backups')).json()).backups.find(b=>b.id===id);
const instance=await provider(''),plan=restoreRetryPlan(id,backup,instance);
if(values.run){
 // Recheck provider state immediately before this non-CAS operator mutation.
 restoreRetryPlan(id,backup,await provider(''));
 await provider('/status',{method:'PATCH',body:JSON.stringify({status:'restart',from:plan.from})});
}
console.log(JSON.stringify({...plan,restart_requested:values.run},null,2));
