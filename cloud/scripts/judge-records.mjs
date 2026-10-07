import { resolve } from 'node:path';
import { boundedFile, rawHash } from './client.mjs';

/** Verify a complete retained record before using its normalized advice. */
export async function readJudgeRecord(root, stage, contextBytes) {
  if (!['flash', 'clef'].includes(stage)) throw new Error('Unknown judge stage');
  const manifest = JSON.parse(await boundedFile(resolve(root, stage, 'manifest.json'), 32768));
  const inputHash = rawHash(contextBytes);
  const model = `@cf/cloudflare/${stage === 'flash' ? 'clef-flash' : 'clef'}`;
  if (manifest.advisory_only !== true || manifest.input_hash !== inputHash || manifest.model !== model
      || !manifest.files?.context || !manifest.files.request || !manifest.files.attempt)
    throw new Error('Frozen judgement identity failed');
  const versionPrefix = manifest.adapter_version ? `${manifest.adapter_version}/` : '';
  if (manifest.judgement !== rawHash(Buffer.from(`${versionPrefix}${manifest.question_schema_version}/${stage}/${inputHash}`)))
    throw new Error('Frozen judgement cache identity failed');
  const documents = {};
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!['context', 'request', 'response', 'attempt'].includes(name) || !/^[0-9a-f]{64}$/.test(expected))
      throw new Error('Unexpected retained judge document');
    const limit = name === 'context' ? 32768 : name === 'request' ? 49152 : 262144;
    const bytes = await boundedFile(resolve(root, stage, `${name}.json`), limit);
    if (rawHash(bytes) !== expected) throw new Error('Frozen judge document hash failed');
    documents[name] = bytes;
  }
  const requestHash = rawHash(documents.request);
  if (rawHash(documents.context) !== inputHash || manifest.request_hash !== requestHash)
    throw new Error('Frozen judge request linkage failed');
  const attempt = JSON.parse(documents.attempt);
  if (attempt.schema_version !== 1 || attempt.input_hash !== inputHash || attempt.fault !== manifest.fault
      || Boolean(attempt.result) === Boolean(attempt.fault)) throw new Error('Frozen judge attempt linkage failed');
  if (attempt.result) {
    const result = attempt.result;
    if (!documents.response || result.input_hash !== inputHash || result.request_hash !== requestHash
        || result.model !== model || result.stage !== (stage === 'flash' ? 'l1a' : 'l1b')
        || result.adapter_version !== manifest.adapter_version || result.question_schema_version !== manifest.question_schema_version)
      throw new Error('Frozen judge result linkage failed');
  }
  return { manifest, attempt };
}
