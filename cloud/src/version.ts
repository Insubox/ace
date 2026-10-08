import type {Env} from './contracts';

// Provider metadata, never the caller's override header, identifies served code.
export function servedVersion(response:Response,env:Env):Response {
  const id=env.WORKER_VERSION?.id;
  const headers=new Headers(response.headers);
  if(!headers.has('cache-control'))headers.set('cache-control','no-store');
  if(id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))headers.set('x-ace-worker-version',id);
  for(const [name,value]of [['x-ace-source-version',env.RELEASE_SOURCE_VERSION],['x-ace-source-hash',env.RELEASE_SOURCE_HASH]])if(value&&/^[a-f0-9]{64}$/.test(value))headers.set(name!,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
