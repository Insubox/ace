import {parseArgs} from 'node:util';
import {resolve,dirname,basename} from 'node:path';
import {sourceFile} from './lib/ace-project.mjs';
import {runTask} from './lib/application-task.mjs';
const {values}=parseArgs({options:{profile:{type:'string'},baseline:{type:'string'},proposals:{type:'string'},output:{type:'string'},ace:{type:'string',default:'target/debug/ace'},image:{type:'string',default:'ace-applications:local'},agent:{type:'string',default:'external-agent'}}});
try{
 if(!values.baseline||!values.proposals||!values.output)throw Error('Use --profile --baseline --proposals JSON-file --output fresh-directory [--ace --image --agent]');
 const path=resolve(values.proposals),proposals=JSON.parse((await sourceFile(dirname(path),basename(path),262144)).toString('utf8'));
 const {summary}=await runTask({profile:values.profile,baseline:values.baseline,proposals,output:values.output,binary:values.ace,image:values.image,agent:values.agent});console.log(JSON.stringify(summary));if(summary.best.passed!==summary.best.total)process.exitCode=1;
}catch(error){console.error('Application task: '+error.message);process.exitCode=1;}
