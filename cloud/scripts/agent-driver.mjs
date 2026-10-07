// Run the local trusted controller; provider output is always untrusted WAT.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { api, rawHash } from './client.mjs';

export const MODEL_NAMES = {
  qwen: '@cf/qwen/qwen2.5-coder-32b-instruct',
  llama: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
};
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function retain(path, bytes) {
  if (await exists(path)) {
    const old = await readFile(path);
    if (!old.equals(Buffer.from(bytes))) throw new Error('Existing retained generation differs; no overwrite performed');
  } else await writeFile(path, bytes, { flag: 'wx' });
}
export async function responseBytes(response, limit = 262144) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty generation response');
  const chunks = []; let count = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    count += value.length; if (count > limit) { await reader.cancel(); throw new Error('Generation response exceeds byte limit'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks, count);
}

export async function providerAttempt(config, task, selector, directory, request = api) {
  if (!(selector in MODEL_NAMES)) throw new Error('Unsupported generator selector');
  const input = Buffer.from(JSON.stringify(task));
  const response = await request(config, `/v1/generate/${selector}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: input, signal: AbortSignal.timeout(60000),
  });
  const manifestBytes = await responseBytes(response, 32768);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema_version !== 1 || manifest.adapter_version !== 'wat-generator-v4'
      || !/^[0-9a-f]{64}$/.test(manifest.generation) || manifest.input_hash !== rawHash(input)
      || manifest.context_hash !== task.context_hash || manifest.provider !== 'cloudflare-workers-ai'
      || manifest.model !== MODEL_NAMES[selector] || manifest.real_evaluation_required !== true
      || manifest.request_hash !== manifest.files?.request || manifest.input_hash !== manifest.files?.context
      || !manifest.files?.attempt || !['context', 'request', 'attempt'].every(n => n in manifest.files)
      || Object.keys(manifest.files).some(n => !['context', 'request', 'response', 'attempt'].includes(n))) {
    throw new Error('Generator manifest is not bound to the frozen task or selected model');
  }
  const documents = {};
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('Invalid generation document hash');
    const bytes = await responseBytes(await request(config, `/v1/generations/${manifest.generation}/${name}`, {
      signal: AbortSignal.timeout(30000),
    }));
    if (rawHash(bytes) !== expected) throw new Error('Retained generation document changed');
    documents[name] = bytes;
  }
  if (!documents.context.equals(input)) throw new Error('Retained task bytes changed');
  const attempt = JSON.parse(documents.attempt);
  if (attempt.schema_version !== 1 || attempt.context_hash !== task.context_hash || attempt.fault !== manifest.fault
      || (attempt.fault !== null && attempt.result !== null)) throw new Error('Generation attempt differs from its manifest');
  if (attempt.result && (attempt.result.cell !== task.context.contract.cell || attempt.result.schema_version !== 1
      || !Array.isArray(attempt.result.candidates) || attempt.result.candidates.length < 1
      || attempt.result.candidates.length > task.context.max_candidates
      || attempt.result.candidates.some(c => c.generator?.provider !== manifest.provider || c.generator?.model !== manifest.model))) {
    throw new Error('Proposals do not belong to the retained model invocation');
  }
  await mkdir(directory, { recursive: true });
  await retain(join(directory, 'manifest.json'), manifestBytes);
  for (const [name, bytes] of Object.entries(documents)) await retain(join(directory, `${name}.json`), bytes);
  return { attempt, receipt: { provider: manifest.provider, model: manifest.model, generation: manifest.generation,
    input_hash: manifest.input_hash, request_hash: manifest.request_hash, response_hash: manifest.files.response ?? null } };
}

function native(binary, args) {
  try {
    return JSON.parse(execFileSync(binary, args, { encoding: 'utf8', maxBuffer: 1_048_576, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    // CLI diagnostics contain registration errors, never provider headers.
    const failure = new Error(`Local ACE command failed: ${String(error.stderr ?? '').slice(0,2048).trim()}`);
    failure.local = true; throw failure;
  }
}

export async function drive({ directory, config, binary = 'ace', models = ['qwen', 'llama'], rounds = 4,
  candidates = 2, attempts = 3, patience = 2, jobs = 2, resume = false,
  request = api, command = native, onProgress = () => {} }) {
  if (!Array.isArray(models) || !models.length || models.some(m => !(m in MODEL_NAMES)) || new Set(models).size !== models.length)
    throw new Error('Choose distinct qwen/llama model selectors');
  const bounds = { rounds, candidates, attempts, patience, jobs };
  for (const [name, max] of Object.entries({ rounds:16, candidates:4, attempts:3, patience:16, jobs:8 })) {
    if (!Number.isInteger(bounds[name]) || bounds[name] < 1 || bounds[name] > max) throw new Error(`Invalid ${name} bound`);
  }
  const root = resolve(directory);
  const campaign = join(root, 'campaign');
  const options = { schema_version: 1, adapter_version: 'wat-generator-v4', storage: 'ace-native-v1', api_origin: config.origin, ...(config.project?{project:config.project}:{}), models, ...bounds };
  if (resume) {
    const saved = JSON.parse(await readFile(join(root, 'driver.json'), 'utf8'));
    if (JSON.stringify(saved) !== JSON.stringify(options)) throw new Error('Resume settings differ from the original bounded campaign');
  } else {
    await mkdir(root);
    await retain(join(root, 'driver.json'), Buffer.from(JSON.stringify(options)));
    command(binary, ['demo', join(root, 'baseline'), '--jobs', String(jobs), '--json']);
    command(binary, ['agent-start', campaign, '--campaign', 'workers-ai', '--baseline-run', join(root,'baseline/run'),
      '--store', join(root,'history'), '--rounds', String(rounds), '--candidates', String(candidates),
      '--attempts', String(attempts), '--patience', String(patience), '--jobs', String(jobs)]);
  }
  while (true) {
    const state = command(binary, ['agent-next', campaign]);
    if (state.stop_reason !== null) { onProgress({ phase:'stopped', rounds:state.completed_rounds, reason:state.stop_reason }); return state; }
    const task = state.task;
    if (!task?.context_hash) throw new Error('Campaign returned no frozen task');
    const c = task.context;
    const selector = models[(c.round + c.attempt - 2) % models.length];
    const providerDirectory = join(root,'providers',`round-${String(c.round).padStart(3,'0')}-attempt-${String(c.attempt).padStart(3,'0')}-${selector}`);
    onProgress({ phase:'generating', round:c.round, attempt:c.attempt, model:selector, context_hash:task.context_hash,
      knowledge_observations:c.memory.observations.length });
    const result = await providerAttempt(config, task, selector, providerDirectory, request);
    if (result.attempt.fault) {
      const file = join(providerDirectory, 'fault.json');
      await retain(file, Buffer.from(JSON.stringify({ context_hash:task.context_hash, fault:result.attempt.fault, provider_receipt:result.receipt })));
      command(binary, ['agent-fault', campaign, file]);
      onProgress({ phase:'generator_fault', round:c.round, fault:result.attempt.fault });
      continue;
    }
    if (!result.attempt.result) throw new Error('Generation has neither result nor fault');
    const file = join(providerDirectory, 'submission.json');
    await retain(file, Buffer.from(JSON.stringify({ context_hash:task.context_hash, proposals:result.attempt.result, provider_receipt:result.receipt })));
    let evaluated;
    try { evaluated = command(binary, ['agent-submit', campaign, file]); }
    catch (error) {
      if (!error.local || !/duplicate compiled artifact|invalid WAT proposal:|assembled WASM exceeds 1 MiB|each WAT source/.test(error.message)) throw error;
      const fault = /duplicate compiled artifact/.test(error.message) ? 'duplicate_proposal' : 'invalid_proposal';
      const faultFile = join(providerDirectory, 'fault.json');
      await retain(faultFile, Buffer.from(JSON.stringify({ context_hash:task.context_hash, fault, provider_receipt:result.receipt,
        compiler_diagnostic:Buffer.from(error.message).subarray(0, 2000).toString('utf8') })));
      command(binary, ['agent-fault', campaign, faultFile]);
      onProgress({ phase:'generator_fault', round:c.round, fault }); continue;
    }
    onProgress({ phase:'evaluated', completed_rounds:evaluated.completed_rounds, winner_fuel:evaluated.winner.mean_fuel,
      winner_hash:evaluated.winner.artifact_hash, stop_reason:evaluated.stop_reason });
  }
}
