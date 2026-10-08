import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proposalFiles,improves} from '../../../scripts/lib/application-task.mjs';
test('complete task proposals cannot edit manifests, locks, test suites or add path traversal',()=>{
 const base={'core.py':'original','dependencies.lock.json':'locked'};
 for(const path of ['../core.py','dependencies.lock.json','tests.py','ace-app.json'])assert.throws(()=>proposalFiles(base,{strategy:'attempt',files:{[path]:'changed'}}));
 assert.throws(()=>proposalFiles(base,{strategy:'attempt',files:{'core.py':'new'},passed:true}));
 assert.deepEqual(proposalFiles(base,{strategy:'repair',files:{'core.py':'repaired'}}),{'core.py':'repaired','dependencies.lock.json':'locked'});
});
test('a higher score cannot advance a native branch if an existing passing case regresses',()=>{
 const best={compiled:true,passed:1,cases:[{id:'a',passed:true},{id:'b',passed:false},{id:'c',passed:false}]};
 assert.equal(improves(best,{compiled:true,passed:2,cases:[{id:'a',passed:false},{id:'b',passed:true},{id:'c',passed:true}]}),false);
 assert.equal(improves(best,{compiled:true,passed:2,cases:[{id:'a',passed:true},{id:'b',passed:true},{id:'c',passed:false}]}),true);
 assert.equal(improves(best,{...best}),false);
});
