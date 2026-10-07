import assert from 'node:assert/strict';
import { MODEL_NAMES } from '../agent-driver.mjs';
import { rawHash } from '../client.mjs';

export const fixtureTask = () => ({ context_hash:'0'.repeat(64), context:{ round:1,attempt:1,max_candidates:2,
  memory:{observations:[]}} });
export function transport(task, selector='qwen', candidates=[{id:'C-fixture',wat:'(module)',strategy:'fixture'}]) {
  const documents = { context:Buffer.from(JSON.stringify(task)), request:Buffer.from('{"messages":[]}'),
    response:Buffer.from(JSON.stringify({response:JSON.stringify({candidates})})),
    attempt:Buffer.from(JSON.stringify({schema_version:1, context_hash:task.context_hash, fault:null,
      result:{schema_version:1,cell:'Gcd',candidates:candidates.map(c=>({...c,generator:{provider:'cloudflare-workers-ai',model:MODEL_NAMES[selector],revision:'wat-generator-v4'}}))}})) };
  const files = Object.fromEntries(Object.entries(documents).map(([name,data])=>[name,rawHash(data)]));
  const manifest={schema_version:1,adapter_version:'wat-generator-v4',generation:'1'.repeat(64),input_hash:files.context,
    request_hash:files.request,context_hash:task.context_hash,provider:'cloudflare-workers-ai',model:MODEL_NAMES[selector],
    real_evaluation_required:true,fault:null,files};
  const paths=[];
  const request = async(_config,path,options={})=> {
    paths.push(path);
    if(path===`/v1/generate/${selector}`) { assert.equal(rawHash(options.body),files.context); return Response.json(manifest); }
    const name=path.split('/').at(-1); assert(name in documents); return new Response(documents[name]);
  };
  return {documents,manifest,request,paths};
}

