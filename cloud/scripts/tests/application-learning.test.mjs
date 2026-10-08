import {test} from 'node:test';import assert from 'node:assert/strict';
import {chooseWithLearning} from '../../../scripts/lib/application-learning.mjs';
test('learning selects a compatible declared repair only for a contract with explicit boolean rejection',()=>{
 const pool=[{recipe:'unrelated',strategy:'a',files:{'core.py':'a'}},{recipe:'strict-boolean-input-validation',strategy:'b',files:{'core.py':'b'}}],memory={rule:'strict-boolean-input-validation'};
 assert.deepEqual(chooseWithLearning(memory,'calculator',pool),{strategy:'b',files:{'core.py':'b'}});
 assert.throws(()=>chooseWithLearning(memory,'unknown',pool));assert.throws(()=>chooseWithLearning({rule:'unknown'},'calculator',pool));assert.throws(()=>chooseWithLearning(memory,'calculator',pool.slice(0,1)));
});
