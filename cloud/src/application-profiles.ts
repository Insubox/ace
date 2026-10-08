import {z} from 'zod';
import {strictJson} from './contracts';
import cases from '../../applications/cases.json';
import templates from '../../applications/templates.json';
import executor from '../../applications/executor.json';
export {cases,templates,executor};
export const profile=z.enum(['hello-world','tictactoe','calculator']);
import nodeTemplates from '../../applications/templates-node.json';
import decimal from '../../applications/vendor/decimal.json';
export {nodeTemplates,decimal};
export const runtime=z.enum(['python3-stdlib-v1','nodejs-decimal-v1']);
export const nodeNames=Object.keys(nodeTemplates.calculator);
export const pythonNames=Object.keys(templates.calculator);
export const appRequest=z.strictObject({request_id:z.uuid(),profile,files:z.record(z.string(),z.string().max(32768)),parent:z.string().regex(/^[0-9a-f]{64}$/).nullable(),branch:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).nullable()}).superRefine((r,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(Object.values(r.files).some(s=>!s.isWellFormed()||new TextEncoder().encode(s).length>32768))fail('application file exceeds 32 KiB or contains invalid Unicode');
 if(Object.values(r.files).reduce((sum,s)=>sum+new TextEncoder().encode(s).length,0)>131072)fail('application source exceeds 128 KiB');
 try{const manifest=z.strictObject({schema_version:z.literal(1),profile,runtime,entrypoint:z.string(),dependencies:z.literal('dependencies.lock.json')}).parse(strictJson(r.files['ace-app.json']!));if(manifest.profile!==r.profile)throw new Error();
  const node=manifest.runtime==='nodejs-decimal-v1',names=node?nodeNames:pythonNames;if(Object.keys(r.files).length!==names.length||names.some(n=>!Object.hasOwn(r.files,n)))throw new Error();if(manifest.entrypoint!==(node?'src/main.cjs':'main.py'))throw new Error();
  if(node){for(const name of ['dependencies.lock.json','package.json','package-lock.json']){const expected=JSON.stringify(strictJson(nodeTemplates[r.profile][name as keyof typeof nodeTemplates.calculator])),actual=JSON.stringify(strictJson(r.files[name]!));if(expected!==actual)throw new Error();}}
  else{if(Object.values(r.files).reduce((sum,s)=>sum+new TextEncoder().encode(s).length,0)>65536)throw new Error();z.strictObject({schema_version:z.literal(1),runtime:z.literal('python3-stdlib-v1'),external:z.array(z.never()).length(0),local:z.tuple([z.literal('core.py')])}).parse(strictJson(r.files['dependencies.lock.json']!));}
 }catch{fail('complete file tree, manifest and immutable dependency locks must match the supported runtime');}
});
export type ApplicationSource=z.infer<typeof appRequest>;
export type AppCase={id:string;input:unknown;expected:unknown};
export type AppReport={schema_version:1;profile:string;runtime:string;compiled:boolean;compile_errors:string[];status:'passed'|'failed';cases:{id:string;passed:boolean;expected:unknown;actual:unknown;error:string|null;diagnostics?:{exit_code:number;stderr:string}}[];passed:number;total:number;source_hash:string;suite_hash:string;image_hash:string|null;scope:string};
export function checkCase(test:AppCase,observation:{exit_code:number;timed_out:boolean;stdout:string;stderr:string}){
 let actual:unknown=null,error:string|null=null;try{actual=strictJson(observation.stdout);}catch{error='output_not_json';}if(observation.timed_out)error='execution_timeout';else if(observation.exit_code!==0)error='execution_failed';
 const equivalent=(a:unknown,b:unknown):boolean=>{if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(b));if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equivalent(v,b[i]));const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>;return Object.keys(aa).length===Object.keys(bb).length&&Object.keys(bb).every(k=>Object.hasOwn(aa,k)&&equivalent(aa[k],bb[k]));};
 const passed=!error&&equivalent(actual,test.expected);return{id:test.id,passed,expected:test.expected,actual,error,...(!passed&&error?{diagnostics:{exit_code:observation.exit_code,stderr:observation.stderr.slice(0,512)}}:{})};
}
