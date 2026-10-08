import {test} from 'node:test';import assert from 'node:assert/strict';
import {releaseGate} from '../lib/release-gate.mjs';
import {fixture} from './release-fixtures.mjs';
test('a release binds approval, merged composition and all trusted independent checks',()=>{const f=fixture();assert.equal(releaseGate(f).source_version,f.head);});
test('rejects self approval, stale decisions, changed source, incomplete checks and infrastructure faults',()=>{
 for(const mutate of [f=>f.review.status='open',f=>f.review.events[0].actor=f.review.author,f=>f.review.events[0].source='f'.repeat(64),f=>f.review.events.push({...f.review.events[0],actor:'account:second',type:'request_changes'}),f=>f.head='f'.repeat(64),f=>f.source.version.files['src/main.rs']='f'.repeat(64),f=>f.evaluation.source_version=f.review.source,f=>f.evaluation.image_id='another-image',f=>f.evaluation.observations.pop(),f=>f.evaluation.observations[0].exit_code=1,f=>f.evaluation.infrastructure_error='timeout']){const f=fixture();mutate(f);assert.throws(()=>releaseGate(f));}
});
