// Read authorized complete-project evidence; never executes retained source.
import {parseArgs} from 'node:util';
import {settings,api} from './client.mjs';
const {values}=parseArgs({options:{project:{type:'string'},baseline:{type:'string'},limit:{type:'string',default:'16'},before:{type:'string'}}});
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(values.project??'')||!/^[0-9a-f]{64}$/.test(values.baseline??'')||!/^([1-9]|[12][0-9]|3[0-2])$/.test(values.limit)||values.before&&!/^[1-9][0-9]{0,3}$/.test(values.before))throw Error('Use --project name --baseline retained-result-hash [--limit 1..32] [--before sequence]');
const query=new URLSearchParams({baseline:values.baseline,limit:values.limit,...(values.before?{before:values.before}:{})});
const response=await api(settings(),`/v1/projects/${values.project}/learning?${query}`,{signal:AbortSignal.timeout(30000)});
console.log(JSON.stringify(await response.json(),null,2));
