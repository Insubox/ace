import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const run = process.argv[2];
if (!run) throw new Error('Usage: node examples/judge-corpus/check-run.mjs <fresh-run-directory>');
const report = JSON.parse(await readFile(resolve(run, 'run.json'), 'utf8')).report;
const actual = new Map(report.results.map(r => [r.candidate.id, r.evaluation]));
assert.equal(actual.size, 25);
assert.equal(actual.get('C-reference')?.outcome, 'qualified');
for (let i = 1; i <= 24; i++) {
  const id = `C-v${String(i).padStart(2, '0')}`;
  const expected = i <= 12 ? 'qualified' : i <= 22 ? 'failed_correctness' : 'failed_resource_limit';
  assert.equal(actual.get(id)?.outcome, expected, id);
  if (expected === 'qualified') assert.equal(actual.get(id).checked_calls, 480, `${id}: complete oracle and benchmark workload`);
}
assert.equal(report.champion?.candidate, 'C-v09');
console.log('Corpus integration: 13 qualified, 10 correctness failures, 2 bounded resource failures; complete workload checked.');
