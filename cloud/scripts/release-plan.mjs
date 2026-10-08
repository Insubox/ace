import {parseArgs} from 'node:util';
import {readPrivateState,writePrivateState} from './lib/private-state.mjs';
import {checkReleasePlan} from './lib/release-plan.mjs';
import {settings} from './client.mjs';
const {values}=parseArgs({options:{project:{type:'string'},review:{type:'string'},before:{type:'string'},candidate:{type:'string'},worker:{type:'string'},evaluation:{type:'string'},policy:{type:'string'},output:{type:'string'}}});
try{
 if(!values.evaluation||!values.policy||!values.output)throw Error('Use --project --review --before --candidate --worker --evaluation private-file --policy private-file --output fresh-private-file');
 const plan={schema_version:1,project:values.project,review:values.review,before:values.before,candidate:values.candidate,worker:values.worker,evaluation:await readPrivateState(values.evaluation),policy:await readPrivateState(values.policy)};
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;if(!/^[a-f0-9]{32}$/.test(account??'')||!token)throw Error('Configure Cloudflare account and token privately');
 const version=async id=>{const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${plan.worker}/versions/${id}`,{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)}),data=await r.json();if(!r.ok||!data.success)throw Error('Cannot verify uploaded version');return data.result;};
 const proof=await checkReleasePlan(plan,settings(),version);await writePrivateState(values.output,{...plan,...proof},{create:true});console.log(JSON.stringify({ready:true,source:proof.authorization.source_version,review:plan.review,candidate:plan.candidate,traffic_changed:false}));
}catch(error){console.error('Release plan: '+error.message);process.exitCode=1;}
