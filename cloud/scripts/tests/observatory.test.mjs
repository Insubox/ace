import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const html=readFileSync(new URL('../../src/dashboard.html',import.meta.url),'utf8');
const context={window:{}};
runInNewContext(html.match(/<script id="observatory-model"[^>]*>([\s\S]*?)<\/script>/)[1],context);
const model=context.window.AceObservatory,hash='a'.repeat(64);
function fixture(){return{version:{kind:{kind:'evaluation',report_hash:hash}},sealed:{content_hash:hash,report:{environment_hash:'b'.repeat(64),config:{project:'sample'},experiment:{id:'EXP-test',created_at:123},intent:{id:'INT-test',cell:'Gcd',objective:'Preserve outputs',evalspec:{id:'ES-test',version:1}},knowledge:{claims:[{id:'CL-test',statement:'A bounded observation',status:'proven',supporting_evidence:['EV-test'],contradicting_evidence:[]}]},results:[{candidate:{id:'C-test'},evaluation:{outcome:'qualified',mean_fuel:23.5},evidence:{evidence:{id:'EV-test'}}}],champion:{candidate:'C-test'}}}};}
function record(f){return{version:f.version,summary:model.describeReport(f.version,f.sealed)}}
test('keeps the recorded qualified winner and does not interpret missing fuel as zero',()=>{const f=fixture(),s=model.describeReport(f.version,f.sealed);assert.equal(s.winner.candidate.id,'C-test');assert.equal(model.finite(null),null);assert.equal(model.finite(Infinity),null);assert.equal(model.finite(-1),null);assert.equal(model.finite(23.5),23.5)});
test('refuses mismatched report identities, duplicate candidates and inconsistent champions',()=>{let f=fixture();f.sealed.content_hash='c'.repeat(64);assert.throws(()=>record(f));f=fixture();f.sealed.report.results.push(structuredClone(f.sealed.report.results[0]));assert.throws(()=>record(f));f=fixture();f.sealed.report.results[0].evaluation.outcome='failed_correctness';assert.throws(()=>record(f))});
test('deduplicates retained observations without merging claims across evaluation contexts',()=>{const a=record(fixture()),b=record(fixture());assert.equal(model.totals([a,b]).observations,1);assert.equal(model.collectClaims([a,b]).length,1);const f=fixture();f.sealed.report.environment_hash='c'.repeat(64);const c=record(f);assert.equal(model.collectClaims([a,c]).length,2)});
test('generator failures remain separate from evaluated code observations',()=>{const fault={version:{kind:{kind:'generator_fault'}}},m=model.totals([record(fixture()),fault]);assert.equal(m.faults,1);assert.equal(m.observations,1);assert.equal(m.evaluations,1)});
test('source and claim strings remain inert and markup uses nonce styles',()=>{const f=fixture();f.sealed.report.knowledge.claims[0].statement='</script><script>globalThis.INJECTED=true</script>';assert.equal(record(f).summary.claims[0].statement,f.sealed.report.knowledge.claims[0].statement);assert.doesNotMatch(html,/\sstyle=/);assert.doesNotMatch(html,/\.innerHTML\s*=/)});
