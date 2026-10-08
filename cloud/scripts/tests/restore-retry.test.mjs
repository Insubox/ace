import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreRetryPlan} from '../lib/restore-retry.mjs';
const id='backup-20261008',message='Too many API requests by single Worker invocation.';
function fixture(){return {backup:{id,status:'completed',manifest_hash:'a'.repeat(64),restore_status:'running',object_count:2784},instance:{params:{id,restore:true},status:'errored',error:{message},steps:[{name:'restore and verify objects 2460-1',type:'step',success:true},{name:'restore and verify objects 2480-1',type:'step',success:false,attempts:[{error:{message}}]},{name:'record infrastructure failure-1',type:'step',success:false}]}};}
test('resumes the failed chunk rather than recopying completed source',()=>{
 const {backup,instance}=fixture(),plan=restoreRetryPlan(id,backup,instance);
 assert.deepEqual(plan.from,{name:'restore and verify objects 2480',count:1,type:'do'});assert.equal(plan.production_source_writes,0);
});
test('rejects live, completed, mismatched and unsealed workflow targets',()=>{
 for(const patch of [{params:{id,restore:false}},{params:{id:'backup-20261009',restore:true}},{status:'running'}]){const {backup,instance}=fixture();assert.throws(()=>restoreRetryPlan(id,backup,{...instance,...patch}));}
 for(const patch of [{status:'requested'},{restore_status:'completed'},{manifest_hash:null}]){const {backup,instance}=fixture();assert.throws(()=>restoreRetryPlan(id,{...backup,...patch},instance));}
});
test('does not retry corruption, an unrelated failed stage or an out-of-bounds chunk',()=>{
 const {backup,instance}=fixture();assert.throws(()=>restoreRetryPlan(id,backup,{...instance,error:{message:'backup hash differs'}}));
 assert.throws(()=>restoreRetryPlan(id,backup,{...instance,steps:[{...instance.steps[1],name:'seal restored drill-1'}]}));
 assert.throws(()=>restoreRetryPlan(id,backup,{...instance,steps:[{...instance.steps[1],name:'restore and verify objects 3000-1'}]}));
});
