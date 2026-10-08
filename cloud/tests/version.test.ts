import {it,expect} from 'vitest';
import worker from '../src/worker';
import {env} from 'cloudflare:test';
import {servedVersion} from '../src/version';
const id='11111111-1111-1111-1111-111111111111';
it('identifies the provider version on public and rejected authenticated requests without trusting overrides',async()=>{
 for(const path of ['/','/v1/auth/me']){
  const response=await worker.fetch(new Request('https://ace'+path,{headers:{'Cloudflare-Workers-Version-Overrides':'ace="22222222-2222-2222-2222-222222222222"'}}),{...env,WORKER_VERSION:{id}});
  expect(response.headers.get('x-ace-worker-version')).toBe(id);
  expect(response.status).toBe(path==='/'?200:401);
  expect(response.headers.get('cache-control')).toBe('no-store');
 }
});
it('preserves response body, security headers and cookies, and tolerates absent metadata locally',async()=>{
 const initial=new Response('body',{status:201,headers:{'set-cookie':'session=redacted; HttpOnly','content-security-policy':"default-src 'none'"}});
 const response=servedVersion(initial,{...env,WORKER_VERSION:{id}});
 expect(response.status).toBe(201);expect(await response.text()).toBe('body');
 expect(response.headers.get('set-cookie')).toBe('session=redacted; HttpOnly');
 expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
 const local=servedVersion(new Response('local'),env);expect(local.headers.get('x-ace-worker-version')).toBeNull();expect(local.headers.get('cache-control')).toBe('no-store');
});
