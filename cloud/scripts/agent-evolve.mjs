import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { settings } from './client.mjs';
import { drive } from './agent-driver.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  ace: { type:'string', default:'ace' }, models: { type:'string', default:'qwen,llama' },
  rounds: { type:'string', default:'4' }, candidates: { type:'string', default:'2' },
  attempts: { type:'string', default:'3' }, patience: { type:'string', default:'2' },
  jobs: { type:'string', default:'2' }, resume: { type:'boolean', default:false },
} });
if (positionals.length !== 1) throw new Error('Usage: node cloud/scripts/agent-evolve.mjs <fresh-directory> [--rounds 4 --models qwen,llama --ace /path/to/ace] [--resume]');
try {
  const result = await drive({ directory: positionals[0], config:settings(), binary:values.ace,
    models:values.models.split(','), rounds:Number(values.rounds), candidates:Number(values.candidates), attempts:Number(values.attempts),
    patience:Number(values.patience), jobs:Number(values.jobs), resume:values.resume,
    onProgress:progress => process.stderr.write(JSON.stringify(progress)+'\n') });
  await writeFile(resolve(positionals[0],'result.json'), JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
} catch (error) {
  process.stderr.write(`ACE agent campaign: ${error.message}\n`); process.exitCode = 1;
}
