import {mkdir,writeFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {api,rawHash,boundedFile} from './client.mjs';
import {nativeHash} from './native-wire.mjs';
import {responseBytes} from './agent-driver.mjs';

const nullDevice=process.platform==='win32'?'NUL':'/dev/null';
const portable=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function sourcePath(path){
 if(typeof path!=='string'||Buffer.byteLength(path)>2048||!path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&Buffer.byteLength(p)<=255&&!/[\\:<>"|?*\x00-\x1f\x7f]/.test(p)&&!/[. ]$/.test(p)&&!/^\.(git|ace)$/i.test(p)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))throw Error('Unsafe workspace source path');return path;
}
function git(args,{cwd,env=process.env}={}){
 try{return execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.autocrlf=false','-c','credential.helper=',...args],{cwd,env:{...env,GIT_CONFIG_GLOBAL:nullDevice,GIT_CONFIG_SYSTEM:nullDevice},encoding:'utf8',maxBuffer:1048576,timeout:120000,stdio:['ignore','pipe','pipe']}).trim();}
 catch{throw Error('Workspace Git operation failed; check network access and the Artifacts credential scope.');}
}
export function credentialEnvironment(remote,token,inherited=process.env){
 const url=new URL(remote);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||typeof token!=='string'||!token||/[\r\n]/.test(token))throw Error('Unsafe Artifacts credential');
 const count=Number(inherited.GIT_CONFIG_COUNT??0);if(!Number.isInteger(count)||count<0||count>100)throw Error('Invalid inherited Git configuration');
 // Append scoped headers without replacing the runtime's inherited Git proxy settings.
 return{...inherited,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:String(count+2),['GIT_CONFIG_KEY_'+count]:'http.'+remote+'.extraHeader',['GIT_CONFIG_VALUE_'+count]:'Authorization: Bearer '+token,['GIT_CONFIG_KEY_'+(count+1)]:'http.followRedirects',['GIT_CONFIG_VALUE_'+(count+1)]:'false'};
}
function pathFor(project,workspace){if(!portable.test(project)||!uuid.test(workspace))throw Error('Invalid project or workspace identity');return'/v1/projects/'+project+'/workspaces/'+workspace;}
async function post(config,path,value,request){const response=await request(config,path,{method:'POST',...(value===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(value)}),signal:AbortSignal.timeout(120000)});return JSON.parse(await responseBytes(response,131072));}
async function push(config,path,directory,commit,request,command){
 const lease=await post(config,path+'/token',undefined,request);const env=credentialEnvironment(lease.remote,lease.token);
 command(['push','--porcelain',lease.remote,commit+':refs/heads/main'],{cwd:directory,env});
}
export async function prepareWorkspace({config,project,workspace,directory,resume=false,request=api,command=git}){
 const endpoint=pathFor(project,workspace),root=resolve(directory),listed=JSON.parse(await responseBytes(await request(config,'/v1/projects/'+project+'/workspaces'),262144)),w=listed.workspaces.find(w=>w.id===workspace);
 if(!listed.configured||!w?.ready||w.closed||w.commit||w.expires_at<=Date.now())throw Error('Workspace is not available for preparation');
 if(resume){
  if(!(await lstat(root)).isDirectory()||!(await lstat(join(root,'.git'))).isDirectory())throw Error('Resume requires a regular workspace directory');
  const meta=JSON.parse(await boundedFile(join(root,'.git','ace-workspace.json'),8192));
  if(meta.schema_version!==1||meta.origin!==config.origin||meta.project!==project||meta.workspace!==workspace||meta.base!==w.base||!/^[0-9a-f]{40}$/.test(meta.seed)||command(['rev-parse','HEAD'],{cwd:root})!==meta.seed||command(['status','--porcelain'],{cwd:root}))throw Error('Resume requires the unchanged prepared baseline');
  await push(config,endpoint,root,meta.seed,request,command);await post(config,endpoint+'/seed',{commit:meta.seed},request);
  return{directory:root,workspace,seed:meta.seed,base:w.base,status:'prepared',context:w.context};
 }
 const sealed=JSON.parse(await responseBytes(await request(config,'/v1/stores/'+project+'/versions/'+w.base),2097152));
 if(sealed.content_hash!==w.base||nativeHash(sealed.version)!==w.base)throw Error('ACE baseline identity differs');
 const files=Object.entries(sealed.version.files);if(!files.length||files.length>512)throw Error('Workspace file count exceeds limit');
 const folded=new Set();for(const[path,hash]of files){sourcePath(path);const key=path.toLowerCase();if(folded.has(key)||!/^[0-9a-f]{64}$/.test(hash))throw Error('Invalid workspace file tree');folded.add(key);}
 for(const[path]of files){const parents=path.toLowerCase().split('/');parents.pop();while(parents.length){if(folded.has(parents.join('/')))throw Error('Workspace file/directory collision');parents.pop();}}
 let total=0;const materialized=[];
 for(const[path,hash]of files){const bytes=await responseBytes(await request(config,'/v1/stores/'+project+'/objects/'+hash,{signal:AbortSignal.timeout(30000)}),1048576);total+=bytes.length;if(total>8388608||rawHash(bytes)!==hash)throw Error('Workspace source hash or byte budget differs');materialized.push([path,bytes]);}
 // Fresh directory only. No source files or existing checkouts are overwritten.
 await mkdir(root,{mode:0o700});
 for(const[path,bytes]of materialized){const parts=path.split('/');parts.pop();if(parts.length)await mkdir(join(root,...parts),{recursive:true});await writeFile(join(root,...path.split('/')),bytes,{flag:'wx',mode:0o600});}
 command(['init','--initial-branch=main'],{cwd:root});command(['add','--all','--force'],{cwd:root});command(['-c','user.name=ACE workspace','-c','user.email=workspace@ace.invalid','commit','--no-verify','-m','ACE baseline '+w.base],{cwd:root});const seed=command(['rev-parse','HEAD'],{cwd:root});if(!/^[0-9a-f]{40}$/.test(seed))throw Error('Workspace seed commit is invalid');
 await writeFile(join(root,'.git','ace-workspace.json'),JSON.stringify({schema_version:1,origin:config.origin,project,workspace,base:w.base,seed,context:w.context})+'\n',{flag:'wx',mode:0o600});
 await push(config,endpoint,root,seed,request,command);await post(config,endpoint+'/seed',{commit:seed},request);
 return{directory:root,workspace,seed,base:w.base,status:'prepared',context:w.context};
}
export async function proposeWorkspace({config,directory,request=api,command=git}){
 const root=resolve(directory);if(!(await lstat(root)).isDirectory()||!(await lstat(join(root,'.git'))).isDirectory())throw Error('Workspace must be a regular directory with a regular .git directory');
 const meta=JSON.parse(await boundedFile(join(root,'.git','ace-workspace.json'),8192));if(meta.schema_version!==1||meta.origin!==config.origin||!/^[0-9a-f]{40}$/.test(meta.seed))throw Error('Workspace belongs to another ACE origin or is invalid');
 const endpoint=pathFor(meta.project,meta.workspace),commit=command(['rev-parse','HEAD'],{cwd:root});if(!/^[0-9a-f]{40}$/.test(commit)||commit===meta.seed)throw Error('Commit the proposed changes before submitting');
 if(command(['status','--porcelain'],{cwd:root}))throw Error('Commit or remove pending working-tree changes before submitting');
 // A retained proposal can be retried after credentials have been revoked.
 const listed=JSON.parse(await responseBytes(await request(config,'/v1/projects/'+meta.project+'/workspaces'),262144)),w=listed.workspaces.find(w=>w.id===meta.workspace);
 if(w?.commit!==commit)await push(config,endpoint,root,commit,request,command);
 return post(config,endpoint+'/proposal',{commit},request);
}
