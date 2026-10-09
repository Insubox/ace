import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareWorkspace,proposeWorkspace,sourcePath,credentialEnvironment} from '../artifact-workspace-driver.mjs';
import {nativeHash} from '../native-wire.mjs';
import {rawHash} from '../client.mjs';
const config={origin:'https://ace.example',token:'private-session'},workspace='abcdef12-3456-4789-abcd-123456789abc';
function fixture(){
 const data=Buffer.from('console.log("baseline");\n'),hash=rawHash(data),version={schema_version:1,parents:[],kind:{kind:'source'},message:'base',files:{'src/main.js':hash,'.gitignore':rawHash(Buffer.from('src/main.js\n'))}},base=nativeHash(version),calls=[],w={id:workspace,ready:true,closed:false,expires_at:Date.now()+100000,base,commit:null,context:'Keep this task context'};
 const request=async(_,path,options={})=>{
  calls.push({path,method:options.method??'GET'});
  if(path.endsWith('/workspaces'))return Response.json({configured:true,workspaces:[w]});
  if(path.endsWith('/versions/'+base))return Response.json({version,content_hash:base});
  if(path.endsWith('/objects/'+hash))return new Response(data);
  if(path.endsWith('/objects/'+rawHash(Buffer.from('src/main.js\n'))))return new Response('src/main.js\n');
  if(path.endsWith('/token'))return Response.json({remote:'https://artifacts.example/repo.git',token:'temporary-secret'});
  if(path.endsWith('/seed'))return Response.json({seed:JSON.parse(options.body).commit});
  if(path.endsWith('/proposal'))return Response.json({version:'f'.repeat(64),qualification:'source_only_requires_independent_review_and_evaluation'});
  throw Error('Unexpected request '+path);
 };
 return{data,base,w,calls,request};
}
test('prepares exact source with real local Git, scopes credentials in memory and submits a clean committed proposal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ace-artifact-client-')),directory=join(root,'agent');const f=fixture(),pushes=[];
 const command=(args,options)=>{if(args[0]==='push'){pushes.push(options.env);return'';}return execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.autocrlf=false',...args],{cwd:options.cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();};
 try{
  const prepared=await prepareWorkspace({config,project:'demo',workspace,directory,request:f.request,command});assert.equal(prepared.base,f.base);assert.equal((await readFile(join(directory,'src/main.js'))).toString(),f.data.toString());assert.equal(pushes.length,1);assert.equal(command(['show','HEAD:src/main.js'],{cwd:directory}),f.data.toString().trim());
  const metadata=await readFile(join(directory,'.git/ace-workspace.json'),'utf8'),gitConfig=await readFile(join(directory,'.git/config'),'utf8');assert.ok(!metadata.includes('temporary-secret'));assert.ok(!gitConfig.includes('temporary-secret'));assert.equal(prepared.context,f.w.context);
  await prepareWorkspace({config,project:'demo',workspace,directory,resume:true,request:f.request,command});assert.equal(pushes.length,2);
  await assert.rejects(proposeWorkspace({config,directory,request:f.request,command}),/Commit the proposed/);
  await writeFile(join(directory,'src/main.js'),'console.log("improved");\n');command(['add','--all'],{cwd:directory});command(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','--no-verify','-m','change'],{cwd:directory});
  const receipt=await proposeWorkspace({config,directory,request:f.request,command});assert.equal(receipt.qualification,'source_only_requires_independent_review_and_evaluation');assert.equal(pushes.length,3);
  f.w.commit=command(['rev-parse','HEAD'],{cwd:directory});await proposeWorkspace({config,directory,request:f.request,command});assert.equal(pushes.length,3);
  await writeFile(join(directory,'src/main.js'),'uncommitted');await assert.rejects(proposeWorkspace({config,directory,request:f.request,command}),/pending working-tree/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('rejects traversal, Git metadata, reserved filenames and credentials with redirects or embedded passwords',()=>{
 for(const path of ['../secret','/secret','src/.git/config','src/.ACE/object','src\\escape','CON.txt','a//b','a/../b','a.'])assert.throws(()=>sourcePath(path));
 assert.equal(sourcePath('src/café.js'),'src/café.js');
 for(const remote of ['http://example/repo','https://user:password@example/repo','https://example/repo?secret=1'])assert.throws(()=>credentialEnvironment(remote,'token'));
 assert.throws(()=>credentialEnvironment('https://example/repo','token\r\nInjected: header'));
 const env=credentialEnvironment('https://example/repo','token',{HTTPS_PROXY:'http://proxy:8080',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.proxy',GIT_CONFIG_VALUE_0:'http://proxy:8080'});assert.equal(env.GIT_CONFIG_COUNT,'3');assert.equal(env.GIT_CONFIG_KEY_0,'http.proxy');assert.equal(env.GIT_CONFIG_KEY_1,'http.https://example/repo.extraHeader');assert.equal(env.GIT_CONFIG_VALUE_2,'false');
});
test('refuses an existing checkout and never overwrites its files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ace-artifact-existing-'));try{await writeFile(join(root,'owned'),'preserve');const f=fixture();await assert.rejects(prepareWorkspace({config,project:'demo',workspace,directory:root,request:f.request}),/EEXIST/);assert.equal(await readFile(join(root,'owned'),'utf8'),'preserve');}finally{await rm(root,{recursive:true,force:true});}
});
test('checks the ACE manifest and source hashes before writing or executing Git',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ace-artifact-bad-'));try{const f=fixture(),request=async(c,p,o)=>p.includes('/objects/')?new Response('corrupted'):f.request(c,p,o);await assert.rejects(prepareWorkspace({config,project:'demo',workspace,directory:join(root,'new'),request,command:()=>{throw Error('Git should not execute');}}),/source hash/);}finally{await rm(root,{recursive:true,force:true});}
});
test('refuses linked .git directories before invoking Git',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(join(tmpdir(),'ace-artifact-link-'));try{await symlink(root,join(root,'.git'));await assert.rejects(proposeWorkspace({config,directory:root,command:()=>{throw Error('Git should not execute');}}),/regular .git/);}finally{await rm(root,{recursive:true,force:true});}
});
