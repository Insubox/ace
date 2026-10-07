// Optional live check. --request explicitly authorizes a bounded paid server check.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {settings,api} from '../cloud/scripts/client.mjs';
const config=settings(),store=process.argv[2]??'native-platform-v030',version=process.argv[3]??'92c2a874f9264edfd80f44b9fd48b82e89c6b416b9b9ed05dfd03267ff991025';
assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(store));assert(/^[0-9a-f]{64}$/.test(version));
const prefix=`/v1/stores/${store}/versions/${version}`,read=async suffix=>(await api(config,prefix+suffix,{signal:AbortSignal.timeout(30000)})).json();
if(process.argv.includes('--request')){
 const result=await(await api(config,prefix+'/verify',{method:'POST',signal:AbortSignal.timeout(30000)})).json();
 console.log(JSON.stringify({requested:result.status}));
}
for(let i=0;i<150;i++){
 const value=await read('/verification');
 if(i%15===0)console.log(JSON.stringify({status:value.status,poll:i}));
 assert.notEqual(value.status,'not_requested','Request verification explicitly with --request first.');
 assert.notEqual(value.status,'failed',value.error);
 if(value.status==='completed'){
  assert.equal(value.receipt.status,'reproduced');assert(value.receipt.candidates.every(c=>c.matched));
  const run=await read('/verification/run');assert.equal(run.content_hash,value.receipt.verified_report_hash);
  assert.equal(run.report.results.length,value.receipt.candidates.length);
  assert.equal(value.receipt.champion,run.report.champion?.candidate??null);
  const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(output)await writeFile(output,JSON.stringify(value,null,2)+'\n');
  console.log(JSON.stringify({completed:true,status:value.receipt.status,champion:value.receipt.champion,observations:value.receipt.candidates.length,same_environment:value.receipt.same_environment}));process.exit(0);
 }
 await new Promise(r=>setTimeout(r,2000));
}
throw new Error('Verification exceeded the polling bound; inspect its status before retrying.');
