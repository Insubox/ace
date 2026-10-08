// Register ACE's own development objectives in its private project. No model/container calls.
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {nativeHash} from './native-wire.mjs';
import {settings,api} from './client.mjs';
const {values}=parseArgs({options:{project:{type:'string',default:'ace-self-development'},version:{type:'string'},owner:{type:'string'},plan:{type:'string',default:'self-host/objectives.json'}}});
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.project)||!/^[0-9a-f]{64}$/.test(values.version??'')||values.owner&&!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(values.owner))throw new Error('Use a private project, published native version and optional existing owner');
const config=settings(),plan=JSON.parse(await readFile(values.plan,'utf8'));
if(plan.schema_version!==1||plan.project!==values.project||plan.objectives.length!==7)throw new Error('Objective plan differs from the selected pilot');
const uuid=key=>{const h=nativeHash([values.project,key]);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
await api(config,'/v1/projects',{method:'POST',body:JSON.stringify({name:values.project})});
if(values.owner)await api(config,`/v1/projects/${values.project}/members`,{method:'POST',body:JSON.stringify({username:values.owner,role:'owner'})});
const log=await(await api(config,`/v1/stores/${values.project}`)).json();if(!log.entries.some(e=>e.version===values.version))throw new Error('Publish the source before linking project objectives');
const path=`/v1/projects/${values.project}/issues`,existing=(await(await api(config,path)).json()).issues,results=[];
for(const item of [...plan.objectives,plan.first_task]){const id=uuid(item.id),old=existing.find(i=>i.id===id);if(old){results.push({id,title:old.title,retained:true});continue;}const body='Objective: '+item.id+'\n\nAcceptance criteria:\n'+item.acceptance.map((s,i)=>(i+1)+'. '+s).join('\n')+'\n\nEvidence must retain exact source, evaluator identity and pass/fail learning. Completion requires the listed checks; a passing partial pilot does not close the whole objective.';const issue=await(await api(config,path,{method:'POST',body:JSON.stringify({id,title:item.title,body,assignee:values.owner??null,version:values.version})})).json();results.push({id,title:issue.title,status:issue.status});}
console.log(JSON.stringify({project:values.project,source_version:values.version,objectives:results},null,2));
