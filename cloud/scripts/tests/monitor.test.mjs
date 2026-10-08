import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observe,notify} from '../monitor.mjs';
test('malformed alerts cannot look healthy and unknown budget fields never leave the monitor',async()=>{
 const read=state=>observe({},async()=>Response.json(state));
 for(const alerts of [['invalid secret text'],[''],[42],Array(65).fill('failure')])assert.deepEqual((await read({schema_version:1,alerts})).alerts,['control_plane_unreachable_or_unauthorized']);
 const budget={day:'2026-10-08',trials_used:8,trials_limit:8,application_replays_used:2,application_replays_limit:2,containers_used:10,containers_limit:16};
 const report=await read({schema_version:1,alerts:['backup_failure','backup_failure'],observatory_budget:{...budget,token:'private-secret',project:'private-project'}});
 assert.deepEqual(report.budget,budget);assert.deepEqual(report.alerts,['backup_failure']);assert(!JSON.stringify(report).includes('private-'));
 assert.deepEqual((await read({schema_version:1,alerts:[],observatory_budget:{...budget,containers_used:-1}})).alerts,['control_plane_unreachable_or_unauthorized']);
});
test('monitor notices control-plane failure without exposing credentials and delivery is opt in',async()=>{const report=await observe({token:'private-secret'},async()=>{throw new Error('private-secret');});assert.deepEqual(report.alerts,['control_plane_unreachable_or_unauthorized']);assert(!JSON.stringify(report).includes('private-secret'));let calls=0;assert.deepEqual(await notify(report,null,null,async()=>{calls++;}),{});assert.equal(calls,0);});
test('delivery deduplicates, retries failure and sends recovery without ACE authentication',async()=>{const snapshot={alerts:['backup_failure'],observed_at:Date.now()},calls=[];const send=async(url,request)=>{calls.push({url,request});return{ok:true};};const saved=await notify(snapshot,null,'https://alerts.example/ingest',send);assert.equal(calls.length,1);assert(!calls[0].request.headers.authorization);await notify(snapshot,saved,'https://alerts.example/ingest',send);assert.equal(calls.length,1);const recovered=await notify({alerts:[]},saved,'https://alerts.example/ingest',send);assert.equal(recovered.alerting,false);assert.equal(calls.length,2);await assert.rejects(notify(snapshot,null,'http://alerts.example',send));await assert.rejects(notify(snapshot,null,'https://alerts.example',async()=>({ok:false})));});
