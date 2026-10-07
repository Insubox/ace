// Native Rust + fixture transport. No accounts, network requests or Git needed.
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {nativeHash} from '../cloud/scripts/native-wire.mjs';
import { pushStore,pullStore,fetchStore,advanceRef } from '../cloud/scripts/store-sync-driver.mjs';
const binary=resolve(process.argv[2]??'target/debug/ace');
const ace=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',env:{PATH:'',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}}));
const root=await mkdtemp(join(tmpdir(),'ace-native-sync-'));
const objects=new Map(),versions=new Map(),entries=[],refEvents=[],heads=Object.create(null);let corrupted=false,requests=0,projectCreates=0;
const request=async(_config,path,init={})=>{
  requests++;if(path==='/v1/projects'){assert.equal(init.method,'POST');assert.equal(JSON.parse(init.body).name,'test');projectCreates++;return Response.json({created:true},{status:201});}const tail=path.split('/').slice(4);
  if(!tail.length)return Response.json({schema_version:1,backend:'ace-native-v1',entries,tip:entries.at(-1)?.content_hash??null});
  const [kind,id]=tail;if(kind==='refs'){if(init.method==='POST'){const event=JSON.parse(init.body);if(!refEvents[event.sequence-1]){assert.equal(event.sequence,refEvents.length+1);assert.equal(event.previous,refEvents.at(-1)?.content_hash??null);assert.equal(event.expected,heads[event.branch]??null);assert.equal(event.content_hash,nativeHash([1,event.sequence,event.previous,event.branch,event.expected,event.target]));refEvents.push(event);heads[event.branch]=event.target;}else assert.equal(refEvents[event.sequence-1].content_hash,event.content_hash);return Response.json({ref:event});}return Response.json({schema_version:1,events:refEvents,heads,tip:refEvents.at(-1)?.content_hash??null});}
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
  await pushStore({...options,config:{token:'ace_session_'+'f'.repeat(64)}});assert.equal(projectCreates,1);
  const originalFirst=entries[0].content_hash;entries[0].content_hash='0'.repeat(64);entries[1].previous=entries[0].content_hash;const before=requests;await assert.rejects(pushStore(options),/identity|order/);assert.equal(requests,before+1);entries[0].content_hash=originalFirst;entries[1].previous=originalFirst;
  const base=ace(['store','log',store]).versions.at(-1).version;ace(['store','branch',store,'main',base]);await pushStore(options);
  const other=join(root,'other');ace(['store','clone',store,other]);
  await writeFile(join(source,'main.txt'),'ours\n');const ours=ace(['store','commit',source,'--store',store,'--files',files,'--message','ours','--parent',base]).version;ace(['store','branch',store,'main',ours,'--expect',base]);await pushStore(options);
  await writeFile(join(source,'main.txt'),'changed\n');await writeFile(join(source,'\ue000.txt'),'theirs\n');const theirs=ace(['store','commit',source,'--store',other,'--files',files,'--message','theirs','--parent',base]).version;ace(['store','branch',other,'main',theirs,'--expect',base]);
  await assert.rejects(pushStore({...options,directory:other}),/fetch/);const imported=await fetchStore({...options,directory:other});assert.equal(imported.imported,1);
  const merge=ace(['store','merge',theirs,ours,'--store',other,'--output',join(root,'merge'),'--message','both branches']);assert.equal(merge.status,'merged');ace(['store','branch',other,'main',merge.version,'--expect',theirs]);
  await assert.rejects(pushStore({...options,directory:other}),/heads diverge/);const reconciled=await pushStore({...options,directory:other,refs:false});assert.equal(reconciled.publication_order_reconciled,true);
  await advanceRef({...options,branch:'main',target:merge.version,expected:ours});assert.equal(heads.main,merge.version);await assert.rejects(advanceRef({...options,branch:'main',target:merge.version,expected:ours}),/changed/);
  const final=join(root,'final');await pullStore({...options,directory:final});assert.equal(ace(['store','refs',final]).heads.main,merge.version);assert.equal(ace(['store','log',final]).versions.length,5);
  // Once both heads agree, independent publication logs remain idempotent.
  await pushStore({...options,directory:other});
  console.log(JSON.stringify({fixture_transport:true,real_native_verification:true,versions:2,shared_objects:2,unicode_paths:true,push_retry:true,private_account_project_creation:true,pull_restore:true,corruption_rejected:true,divergence_rejected:true,native_branch_cas:true,divergent_dags_reconciled:true,merge_version_ids_preserved:true,paid_model_calls:0}));
}finally{await rm(root,{recursive:true,force:true});}
