import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import {constants} from 'node:fs';

export function settings() {
  const url = new URL(process.env.ACE_API_URL ?? '');
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('ACE_API_URL must be an HTTPS origin (localhost HTTP is allowed)');
  const token = process.env.ACE_API_TOKEN;
  if (!token || token.length < 32) throw new Error('Set ACE_API_TOKEN to the configured Worker bearer token');
  const project=process.env.ACE_PROJECT;
  if(project&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(project))throw new Error('ACE_PROJECT is invalid');
  return { origin: url.origin, token, ...(project?{project}:{}) };
}
export function rawHash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export async function boundedFile(path, limit) {
  if(!Number.isSafeInteger(limit)||limit<0||limit>8388608)throw Error('Invalid file byte budget');
  const file = await open(path, constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await file.stat();if(!stat.isFile())throw Error('Input must be a regular file');
    if (stat.size > limit) throw new Error('File exceeds upload limit');
    const bytes = Buffer.alloc(limit + 1); let offset = 0;
    while (offset < bytes.length) { const read = await file.read(bytes, offset, bytes.length - offset, null); if (!read.bytesRead) break; offset += read.bytesRead; }
    if (offset > limit) throw new Error('File exceeds upload limit'); return bytes.subarray(0, offset);
  } finally { await file.close(); }
}
export async function api(config, path, init = {}) {
  const response = await fetch(config.origin + path, { ...init, redirect: 'error', headers: { ...(config.project?{'x-ace-project':config.project}:{}), ...init.headers, authorization: `Bearer ${config.token}` } });
  if (!response.ok){const error=new Error(`ACE request failed with HTTP ${response.status}: ${await response.text()}`);error.status=response.status;throw error;}
  return response;
}
