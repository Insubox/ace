import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeHash,validateRefs} from '../native-wire.mjs';
import {createHash} from 'node:crypto';
test('native wire hashes Unicode keys in the same scalar order as Rust',()=>{
 const expected=createHash('sha256').update('ace:canonical-json:v1\0{"\ue000":2,"\u{10000}":1}').digest('hex');assert.equal(nativeHash({'\u{10000}':1,'\ue000':2}),expected);
});
test('reference transport rejects altered seals, expectations, heads and unpublished versions',()=>{
 const target='a'.repeat(64),event={schema_version:1,sequence:1,previous:null,branch:'constructor',expected:null,target,content_hash:nativeHash([1,1,null,'constructor',null,target])};
 const log={schema_version:1,events:[event],heads:{constructor:target},tip:event.content_hash};assert.equal(validateRefs(log,new Set([target])),log);
 for(const changed of[{...log,tip:'0'.repeat(64)},{...log,heads:{}},{...log,events:[{...event,expected:target}]},{...log,events:[{...event,target:'b'.repeat(64)}]}])assert.throws(()=>validateRefs(changed,new Set([target])),/reference|heads/);
 assert.throws(()=>validateRefs(log,new Set()),/reference/);
});
