import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireServedVersion} from '../lib/version-smoke.mjs';
test('a ignored or wrong version override cannot pass release validation',()=>{
 for(const actual of [null,'old-version']){
  const response=new Response('',{headers:actual?{'x-ace-worker-version':actual}:{}});
  assert.throws(()=>requireServedVersion(response,'expected-version'));
 }
 requireServedVersion(new Response('',{headers:{'x-ace-worker-version':'expected-version'}}),'expected-version');
});
