import { stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { boundedFile } from './client.mjs';
import { readJudgeRecord } from './judge-records.mjs';
import { comparisonHtml } from './comparison-html.mjs';

const [run, output, ...judgements] = process.argv.slice(2);
if (!run || !output || !judgements.length)
  throw new Error('Usage: node cloud/scripts/judge-compare.mjs <verified-run> <fresh-output-directory> <judgement-directory>...');
// This validates retained L1a records, seals and ground truth, and creates the
// exclusive output directory. No paid inference or remote mutation is needed.
execFileSync(process.execPath, [fileURLToPath(new URL('./judge-calibration.mjs', import.meta.url)), run, output, ...judgements], { stdio: 'pipe' });
const root = resolve(output);
const first = JSON.parse(await boundedFile(resolve(root, 'dataset.json'), 8388608));
const second = [];
for (const directory of judgements) {
  try { await stat(resolve(directory, 'clef/manifest.json')); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const bytes = await boundedFile(resolve(directory, 'context.json'), 32768);
  second.push((await readJudgeRecord(resolve(directory), 'clef', bytes)).attempt);
}
const dataset = resolve(root, 'comparison-dataset.json');
await writeFile(dataset, JSON.stringify({ schema_version: 1, first_stage: first, second_stage: second }, null, 2), { flag: 'wx' });
const report = execFileSync('ace', ['judge', 'compare', dataset, '--run', resolve(run)], { encoding: 'utf8' });
await writeFile(resolve(root, 'comparison-report.json'), report, { flag: 'wx' });
await writeFile(resolve(root, 'comparison-report.html'), comparisonHtml(JSON.parse(report)), { flag: 'wx' });
console.log(report);
