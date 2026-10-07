// Native Rust + fixture transport. No accounts, network requests or Git needed.
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pushStore,pullStore } from '../cloud/scripts/store-sync-driver.mjs';
const binary=resolve(process.argv[2]??'target/debug/ace');
const ace=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',env:{PATH:'',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}}));
const root=await mkdtemp(join(tmpdir(),'ace-native-sync-'));
const objects=new Map(),versions=new Map(),entries=[];let corrupted=false,requests=0;
const request=async(_config,path,init={})=>{
  requests++;const tail=path.split('/').slice(4);
  if(!tail.length)return Response.json({schema_version:1,backend:'ace-native-v1',entries,tip:entries.at(-1)?.content_hash??null});
  const [kind,id]=tail;
  if(init.method==='PUT'){(kind==='objects'?objects:versions).set(id,Buffer.from(init.body));return Response.json({retained:true});}
  if(init.method==='POST'){const e=JSON.parse(init.body);if(!entries[e.sequence-1])entries.push(e);else assert.equal(entries[e.sequence-1].content_hash,e.content_hash);return Response.json({entry:e});}
  const bytes=(kind==='objects'?objects:versions).get(id);assert(bytes);return new Response(corrupted&&kind==='objects'?Buffer.from('corrupted'):bytes);
};
try{
  const source=join(root,'source'),store=join(root,'history'),files=join(root,'files.json');await mkdir(source);
  const paths=['main.txt','\ue000.txt','\u{10000}.txt'];for(const name of paths)await writeFile(join(source,name),'exact\r\nsource\n');await writeFile(files,JSON.stringify(paths));
  ace(['store','commit',source,'--store',store,'--files',files,'--message','first']);await writeFile(join(source,'main.txt'),'changed\n');ace(['store','commit',source,'--store',store,'--files',files,'--message','second']);
  const config={origin:'https://fixture.invalid',token:'fixture-only'};const options={directory:store,name:'test',config,binary,request,run:(_bin,args)=>ace(args)};
  const first=await pushStore(options);assert.equal(first.versions,2);assert.equal(first.objects,2);assert.equal(entries.length,2);
  assert.deepEqual(await pushStore(options),first);assert.equal(entries.length,2);
  const copy=join(root,'copied');const pulled=await pullStore({...options,directory:copy});assert.equal(pulled.verified,true);assert.equal(pulled.tip,first.tip);
  assert.deepEqual(ace(['store','log',copy]).versions,ace(['store','log',store]).versions);
  const last=entries.at(-1).version,checkout=join(root,'restored');ace(['store','checkout',last,'--store',copy,'--output',checkout]);assert.equal(await readFile(join(checkout,'main.txt'),'utf8'),'changed\n');
  await assert.rejects(pullStore({...options,directory:copy}),/EEXIST/);
  corrupted=true;await assert.rejects(pullStore({...options,directory:join(root,'corrupted')}),/hash differs/);corrupted=false;
  entries[0].content_hash='0'.repeat(64);entries[1].previous=entries[0].content_hash;const before=requests;await assert.rejects(pushStore(options),/diverges/);assert.equal(requests,before+1);
  console.log(JSON.stringify({fixture_transport:true,real_native_verification:true,versions:2,shared_objects:2,unicode_paths:true,push_retry:true,pull_restore:true,corruption_rejected:true,divergence_rejected:true,paid_model_calls:0}));
}finally{await rm(root,{recursive:true,force:true});}
