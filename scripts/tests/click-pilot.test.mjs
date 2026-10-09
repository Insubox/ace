import test from 'node:test';
import assert from 'node:assert/strict';
import {decision,proposal} from '../lib/click-pilot.mjs';
const report=cases=>({build_exit:0,compile_exit:0,test_exit:0,cases:cases.map(([id,status])=>({id,status}))});

test('Click selection rejects a larger pass count that regresses a previously passing case',()=>{
 const best=report([['a','passed'],['b','failed'],['c','failed']]);
 const candidate=report([['a','failed'],['b','passed'],['c','passed']]);candidate.test_exit=1;
 assert.deepEqual(decision(best,candidate),{accepted:false,regression:true});
 const winner=report([['a','passed'],['b','passed'],['c','passed']]);
 assert.deepEqual(decision(best,winner),{accepted:true,regression:false});
});

test('Click selection protects case identities and skipped/expected-failure status',()=>{
 const best=report([['a','passed'],['b','failed'],['platform','skipped'],['known','expected_failure']]);
 assert.throws(()=>decision(best,report([['a','passed'],['other','passed'],['platform','skipped'],['known','expected_failure']])),/identities/);
 assert.equal(decision(best,report([['a','passed'],['b','passed'],['platform','expected_failure'],['known','expected_failure']])).accepted,false);
 assert.equal(decision(best,report([['a','passed'],['b','passed'],['platform','skipped'],['known','expected_failure']])).accepted,true);
 assert.equal(decision(best,{build_exit:1,cases:[]}).accepted,false);
});

test('Click proposals cannot replace dependencies, tests, the evaluator or unrelated source',()=>{
 const original={'src/click/types.py':Buffer.from('original'),'uv.lock':Buffer.from('protected')};
 for(const p of ['uv.lock','tests/test_shell_completion.py','../types.py','harness/evaluate.py','src/click/core.py'])assert.throws(()=>proposal(original,{strategy:'edit',files:{[p]:'replacement'}}));
 const result=proposal(original,{strategy:'edit matching source',files:{'src/click/types.py':'changed'}});
 assert.equal(result['src/click/types.py'].toString(),'changed');
 assert.equal(result['uv.lock'],original['uv.lock']);
 assert.throws(()=>proposal(original,{strategy:'edit',files:{'src/click/types.py':'x'.repeat(131073)}}));
});
