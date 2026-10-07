import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { boundedFile } from './client.mjs';

const [run, candidate, publicSummary, output] = process.argv.slice(2);
if (!run || !candidate || !publicSummary || !output)
  throw new Error('Usage: node cloud/scripts/judge-context.mjs <verified-run> <candidate> <public-summary-file> <fresh-context.json>');
// Verify seals, artifacts and Rust policy before using run identities/references.
execFileSync('ace', ['status', resolve(run)], { stdio: 'pipe' });
const saved = JSON.parse(await boundedFile(resolve(run, 'run.json'), 3145728)).report;
if (saved.config.cell !== 'Gcd') throw new Error('The current question schema supports Gcd only');
const chosen = saved.results.find(r => r.candidate.id === candidate);
if (!chosen) throw new Error('Candidate is not registered in this run');
const summary = new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(resolve(publicSummary), 8192));
if (!summary.trim()) throw new Error('Public summary cannot be blank');
const context = { schema_version: 1, experiment: saved.experiment.id, candidate,
  artifact_hash: chosen.candidate.patch.hash,
  contract_summary: 'Import-free gcd(u32, u32) -> u32. Return the greatest common divisor; gcd(0, 0) = 0. No host imports or external state.',
  intent_summary: 'Reduce measured Wasmi fuel without changing the public GCD contract.',
  candidate_summary: summary, high_impact: false,
  known_failures: saved.results.filter(r => ['failed_correctness', 'failed_resource_limit'].includes(r.evaluation.outcome)
    && r.candidate.patch.hash !== chosen.candidate.patch.hash).slice(0, 8).map(r => ({ experiment: saved.experiment.id,
      evidence: r.evidence.evidence.id, content_hash: r.evidence.content_hash })) };
await writeFile(resolve(output), JSON.stringify(context, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ experiment: context.experiment, candidate, artifact_hash: context.artifact_hash, public_context: resolve(output) }));
