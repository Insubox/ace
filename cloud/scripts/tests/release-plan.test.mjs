import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './release-fixtures.mjs';import {checkReleasePlan} from '../lib/release-plan.mjs';
test('release plans verify live approval, current branch, uploaded source binding and artifact identity',async()=>{
 const f=fixture(),plan={schema_version:1,before:'22222222-2222-2222-2222-222222222222',candidate:'33333333-3333-3333-3333-333333333333',review:f.review.id,project:'private',worker:'ace',policy:f.policy,evaluation:f.evaluation};
 const request=async(_c,path)=>Response.json(path.endsWith('/refs')?{heads:{main:f.head}}:path.includes('/reviews/')?f.review:f.source);
 const uploaded={resources:{script:{etag:'immutable-artifact'},bindings:[{type:'plain_text',name:'RELEASE_SOURCE_VERSION',text:f.head},{type:'plain_text',name:'RELEASE_SOURCE_HASH',text:f.evaluation.source_hash},{type:'plain_text',name:'SPENDING_CONTROL_MODE',text:'enforce'},{type:'version_metadata',name:'WORKER_VERSION'}]}};
 const proof=await checkReleasePlan(plan,{},async()=>uploaded,request);assert.equal(proof.script_etag,'immutable-artifact');
 await assert.rejects(checkReleasePlan({...plan,...proof}, {},async()=>({...uploaded,resources:{...uploaded.resources,script:{etag:'different'}}}),request));
 for(const name of ['RELEASE_SOURCE_VERSION','RELEASE_SOURCE_HASH','SPENDING_CONTROL_MODE','WORKER_VERSION'])await assert.rejects(checkReleasePlan(plan,{},async()=>({...uploaded,resources:{...uploaded.resources,bindings:uploaded.resources.bindings.filter(b=>b.name!==name)}}),request));
 f.review.status='open';await assert.rejects(checkReleasePlan(plan,{},async()=>uploaded,request));
});
