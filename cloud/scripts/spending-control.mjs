// Infrastructure operator only. Never assumes missing account spend is zero.
import {parseArgs} from 'node:util';
import {settings,api,boundedFile} from './client.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{snapshot:{type:'string'}}});
const action=positionals[0]??'status';
if(positionals.length>1||!['status','pause','update'].includes(action)||((action==='update')!==!!values.snapshot))throw Error('Use status | pause | update --snapshot private-json-file');
const config=settings(),current=await(await api(config,'/v1/spending-control',{signal:AbortSignal.timeout(20000)})).json();
if(action==='status'){console.log(JSON.stringify(current));}
else{
 if(!Number.isSafeInteger(current.revision))throw Error('An infrastructure operator token is required');
 const input=action==='pause'?{}:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedFile(values.snapshot,2048)));
 if(Object.hasOwn(input,'revision'))throw Error('Omit revision from the input; the client binds the current revision');
 const response=await api(config,'/v1/spending-control'+(action==='pause'?'/pause':''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,revision:current.revision}),signal:AbortSignal.timeout(20000)});
 console.log(JSON.stringify(await response.json()));
}
