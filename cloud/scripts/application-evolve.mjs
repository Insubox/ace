// Hosted bounded application evolution. No credential or provider trace is printed.
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {settings,api} from './client.mjs';
const {values}=parseArgs({options:{project:{type:'string'},baseline:{type:'string'},model:{type:'string',default:'qwen'},rounds:{type:'string',default:'2'},patience:{type:'string',default:'2'},branch:{type:'string'},resume:{type:'string'}}});
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.project??''))throw new Error('Use --project with a private ACE project');
const config=settings(),path=`/v1/projects/${values.project}/application-campaigns`;
let id=values.resume;
if(id&&!/^campaign-[0-9a-f]{64}$/.test(id))throw new Error('Invalid --resume campaign ID');
if(!id){
 if(!/^app-[0-9a-f]{64}$/.test(values.baseline??''))throw new Error('Use --baseline with a completed server application run');
 const body=JSON.stringify({request_id:randomUUID(),baseline_run:values.baseline,model:values.model,rounds:Number(values.rounds),patience:Number(values.patience),branch:values.branch??null});
 let response;for(let attempt=0;attempt<2;attempt++){try{response=await api(config,path,{method:'POST',body});break;}catch(error){if(attempt||error.status&&error.status<500)throw error;}}
 id=(await response.json()).id;console.log(JSON.stringify({campaign:id,accepted:true}));
}
for(let poll=0;poll<360;poll++){
 const result=await(await api(config,path+'/'+id)).json();
 if(poll%6===0||!['requested','running'].includes(result.status))console.log(JSON.stringify({campaign:id,status:result.status,best_passed:result.state.best_passed,total:result.state.total,rounds:result.state.rounds.length,stop_reason:result.state.stop_reason,summary_version:result.state.summary_version??null}));
 if(!['requested','running'].includes(result.status)){if(result.status==='failed')process.exitCode=1;break;}
 if(poll===359)throw new Error(`Campaign is still running; resume with --resume ${id}`);
 await new Promise(resolve=>setTimeout(resolve,2000));
}
