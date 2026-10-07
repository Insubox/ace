import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { boundedFile } from './client.mjs';
import { readJudgeRecord } from './judge-records.mjs';

const [run, output, ...judgements] = process.argv.slice(2);
if (!run || !output || !judgements.length)
  throw new Error('Usage: node cloud/scripts/judge-calibration.mjs <verified-run> <fresh-output-directory> <judgement-directory>...');
const source = resolve(run);
execFileSync('ace', ['status', source], { stdio: 'pipe' });
const report = JSON.parse(await boundedFile(resolve(source, 'run.json'), 3145728)).report;
const rows = [];
for (const directory of judgements) {
  const root = resolve(directory);
  const contextBytes = await boundedFile(resolve(root, 'context.json'), 32768);
  const context = JSON.parse(contextBytes);
  // Keep model/stage cohorts separate: only L1a belongs in this dataset.
  const { manifest, attempt } = await readJudgeRecord(root, 'flash', contextBytes);
  const candidate = report.results.find(r => r.candidate.id === context.candidate);
  if (context.experiment !== report.experiment.id || !candidate || context.artifact_hash !== candidate.candidate.patch.hash)
    throw new Error('Judgement does not belong to the verified source run');
  const labels = { qualified: 'qualified', failed_correctness: 'correctness_failure',
    failed_contract: 'contract_failure', invalid_module: 'contract_failure', failed_resource_limit: 'resource_failure',
    budget_exhausted: 'infrastructure_failure', evaluator_error: 'infrastructure_failure' };
  const label = labels[candidate.evaluation.outcome];
  if (!label) throw new Error('Unknown execution outcome');
  rows.push({ context, context_bytes: new TextDecoder('utf-8', { fatal: true }).decode(contextBytes), input_hash: manifest.input_hash,
    evidence: { experiment: report.experiment.id, evidence: candidate.evidence.evidence.id, content_hash: candidate.evidence.content_hash },
    label, winner: report.champion?.candidate === context.candidate, result: attempt.result, fault: attempt.fault });
}
const root = resolve(output); await mkdir(root);
const dataset = resolve(root, 'dataset.json');
await writeFile(dataset, JSON.stringify({ schema_version: 1, version: 'gcd-clef-flash-shadow-v1', synthetic_predictions: false, rows }, null, 2), { flag: 'wx' });
const result = execFileSync('ace', ['judge', 'calibrate', dataset, '--run', source], { encoding: 'utf8' });
await writeFile(resolve(root, 'report.json'), result, { flag: 'wx' });
console.log(result);
