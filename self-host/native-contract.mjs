// Independent black-box capacity checks. The candidate cannot replace this suite.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update('ace:canonical-json:v1\0'+canonical(v)).digest('hex');
const binary=resolve(process.argv[2]),root=await mkdtemp(join(tmpdir(),'ace-self-contract-'));
const run=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:4194304,env:{PATH:''}}));
const rejected=args=>{const r=spawnSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:4194304,env:{PATH:''}});assert(!r.error);assert.equal(r.signal,null);assert.notEqual(r.status,0);};
const cases=[];
try{
 const store=join(root,'history');await mkdir(store);for(const p of ['objects','versions','journal','views'])await mkdir(join(store,p));await writeFile(join(store,'.ace-store.json'),'{"ace_native_store":1}\n');
 const bytes=Buffer.from('ACE exact source\r\n'),object=createHash('sha256').update(bytes).digest('hex');await writeFile(join(store,'objects',object),bytes);
 let previous=null,tip=null;
 for(let i=1;i<=1024;i++){const version={schema_version:1,parents:tip?[tip]:[],kind:{kind:'source'},message:'Fixture '+i,files:{'source.txt':object}},id=hash(version),entry={schema_version:1,sequence:i,previous,version:id};entry.content_hash=hash([1,i,previous,id]);await writeFile(join(store,'versions',id+'.json'),JSON.stringify({version,content_hash:id}));await writeFile(join(store,'journal',String(i).padStart(8,'0')+'.json'),JSON.stringify(entry));previous=entry.content_hash;tip=id;}
 try{assert.equal(run(['store','log',store]).versions.length,1024);const source=join(root,'source');await mkdir(source);await writeFile(join(source,'new.txt'),'new');const list=join(root,'files.json');await writeFile(list,'["new.txt"]');rejected(['store','commit',source,'--store',store,'--files',list,'--message','over limit']);assert.equal(run(['store','log',store]).versions.length,1024);cases.push({id:'versions-1024-boundary',passed:true});}catch{cases.push({id:'versions-1024-boundary',passed:false});}
 try{const clone=join(root,'clone');run(['store','clone',store,clone]);const restored=join(root,'restored');run(['store','checkout',tip,'--store',clone,'--output',restored]);assert.deepEqual(await readFile(join(restored,'source.txt')),bytes);cases.push({id:'maximum-history-clone-restore',passed:true});}catch{cases.push({id:'maximum-history-clone-restore',passed:false});}
 // Use a separate one-version store so a version limit cannot hide a ref defect.
 const refs=join(root,'references'),source=join(root,'ref-source'),list=join(root,'ref-files.json');await mkdir(source);await writeFile(join(source,'x.txt'),'x');await writeFile(list,'["x.txt"]');const first=run(['store','commit',source,'--store',refs,'--files',list,'--message','refs']).version;await mkdir(join(refs,'refs'));previous=null;
 for(let i=1;i<=4096;i++){const expected=i===1?null:first,event={schema_version:1,sequence:i,previous,branch:'main',expected,target:first};event.content_hash=hash([1,i,previous,'main',expected,first]);await writeFile(join(refs,'refs',String(i).padStart(8,'0')+'.json'),JSON.stringify(event));previous=event.content_hash;}
 try{assert.equal(run(['store','refs',refs]).events.length,4096);rejected(['store','branch',refs,'main',first,'--expect',first]);assert.equal(run(['store','refs',refs]).events.length,4096);cases.push({id:'references-4096-boundary',passed:true});}catch{cases.push({id:'references-4096-boundary',passed:false});}
 console.log(JSON.stringify({schema_version:1,cases,passed:cases.filter(c=>c.passed).length,total:cases.length}));
 process.exitCode=cases.every(c=>c.passed)?0:1;
}finally{await rm(root,{recursive:true,force:true});}
