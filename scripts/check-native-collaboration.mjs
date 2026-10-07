// --request publishes a small explicit source-only collaboration demonstration.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {settings,api} from '../cloud/scripts/client.mjs';
import {pushStore,pullStore,fetchStore,advanceRef} from '../cloud/scripts/store-sync-driver.mjs';
const {values}=parseArgs({options:{request:{type:'boolean',default:false},name:{type:'string',default:'native-branches-v04'},output:{type:'string'},ace:{type:'string',default:'ace'}}});
const config=settings(),binary=values.ace,name=values.name;
if(!values.request){console.log(JSON.stringify(await(await api(config,`/v1/stores/${name}/refs`)).json()));process.exit(0);}
assert(values.output,'Choose a fresh --output directory');const root=resolve(values.output);await mkdir(root);const source=join(root,'source'),a=join(root,'alice'),b=join(root,'bob'),files=join(root,'files.json');await mkdir(source);await writeFile(files,JSON.stringify(['code.txt']));
const ace=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',maxBuffer:16777216}));
const commit=async(store,text,message,parent)=>{await writeFile(join(source,'code.txt'),text);return ace(['store','commit',source,'--store',store,'--files',files,'--message',message,...(parent?['--parent',parent]:[])]).version;};
const base=await commit(a,'one\ntwo\nthree\n','shared ancestor');ace(['store','branch',a,'main',base]);ace(['store','clone',a,b]);const options={name,config,binary};await pushStore({...options,directory:a});
const ours=await commit(a,'ONE\ntwo\nthree\n','change first line',base);ace(['store','branch',a,'main',ours,'--expect',base]);await pushStore({...options,directory:a});
const theirs=await commit(b,'one\ntwo\nTHREE\n','change third line',base);ace(['store','branch',b,'main',theirs,'--expect',base]);await assert.rejects(pushStore({...options,directory:b}),/fetch/);await fetchStore({...options,directory:b});
const merged=ace(['store','merge',theirs,ours,'--store',b,'--output',join(root,'merge'),'--message','combine independently authored changes']);assert.equal(merged.status,'merged');assert.equal(await readFile(join(root,'merge/merged/code.txt'),'utf8'),'ONE\ntwo\nTHREE\n');ace(['store','branch',b,'main',merged.version,'--expect',theirs]);
await pushStore({...options,directory:b,refs:false});await advanceRef({...options,branch:'main',target:merged.version,expected:ours});await assert.rejects(advanceRef({...options,branch:'main',target:merged.version,expected:ours}),/changed/);await pushStore({...options,directory:b});
const pulled=await pullStore({...options,directory:join(root,'restored')});assert.equal(pulled.versions,4);assert.equal(ace(['store','refs',join(root,'restored')]).heads.main,merged.version);const result={store:name,versions:4,merged:merged.version,branch:'main',stale_update_refused:true,divergent_publication_orders_reconciled:true,immutable_version_ids_preserved:true,restored_native_history_verified:true,source_only:true,paid_model_calls:0};await writeFile(join(root,'validation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
