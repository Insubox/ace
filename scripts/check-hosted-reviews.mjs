// Explicit isolated native review smoke. --request creates a temporary writer,
// a private demonstration project and source-only native versions. No containers.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {settings,api} from '../cloud/scripts/client.mjs';
import {pushStore,pullStore} from '../cloud/scripts/store-sync-driver.mjs';
const {values}=parseArgs({options:{request:{type:'boolean',default:false},project:{type:'string',default:'hosted-reviews-v1'},output:{type:'string'},ace:{type:'string',default:'target/debug/ace'}}});const config=settings(),name=values.project,binary=resolve(values.ace);assert.match(name,/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
if(!values.request){console.log(JSON.stringify(await(await api(config,`/v1/stores/${name}/reviews`)).json()));process.exit(0);}assert(values.output);assert(process.env.CLOUDFLARE_API_TOKEN&&process.env.CLOUDFLARE_ACCOUNT_ID);const root=resolve(values.output);await mkdir(root);const username='review-test-'+randomUUID().slice(0,8),password=randomBytes(32).toString('base64url');
const post=(cfg,path,body)=>api(cfg,path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
let account;
try{
 await post(config,'/v1/users',{username,password,role:'writer'});const session=await(await post(config,'/v1/auth/login',{username,password})).json();account={...config,token:session.token};await post(account,'/v1/projects',{name});const source=join(root,'source'),store=join(root,'native'),files=join(root,'files.json');await mkdir(source);await writeFile(files,JSON.stringify(['app.txt']));const ace=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',maxBuffer:2097152}));
 async function commit(text,message,parent){await writeFile(join(source,'app.txt'),text);return ace(['store','commit',source,'--store',store,'--files',files,'--message',message,...(parent?['--parent',parent]:[])]).version;}
 const base=await commit('one\r\ntwo\r\nthree\r\n','shared source'),target=await commit('ONE\r\ntwo\r\nthree\r\n','target branch',base),incoming=await commit('one\r\ntwo\r\nTHREE\r\n','source branch',base);ace(['store','branch',store,'main',target]);ace(['store','branch',store,'feature',incoming]);await pushStore({directory:store,name,config:account,binary});
 const path=`/v1/stores/${name}/reviews`,request={id:randomUUID(),title:'Combine independently reviewed native changes',source_branch:'feature',target_branch:'main',source:incoming,target};const review=await(await post(account,path,request)).json();assert.equal((await(await post(account,path,request)).json()).id,review.id);
 const event={id:randomUUID(),type:'approve',body:'Verified the exact native source comparison',revision:1,source:incoming,target};await assert.rejects(post(account,path+'/'+review.id+'/events',event),e=>e.status===403);await post(config,path+'/'+review.id+'/events',event);const merged=await(await post(account,path+'/'+review.id+'/merge',{})).json();assert.equal(merged.status,'merged');assert.equal((await(await post(account,path+'/'+review.id+'/merge',{})).json()).review.merge.version,merged.review.merge.version);
 const restored=join(root,'restored');await pullStore({directory:restored,name,config:account,binary});const preview=join(root,'rust-merge'),local=ace(['store','merge',target,incoming,'--store',store,'--output',preview,'--message','Merge review '+review.id+': '+review.title]);assert.equal(local.version,merged.review.merge.version);const checkout=join(root,'checkout');ace(['store','checkout',local.version,'--store',restored,'--output',checkout]);assert.equal(await readFile(join(checkout,'app.txt'),'utf8'),'ONE\r\ntwo\r\nTHREE\r\n');const comparison=await(await api(account,`/v1/stores/${name}/compare?left=${target}&right=${incoming}`)).json();assert.equal(comparison.changes[0].path,'app.txt');const result={project:name,request:review.id,merged_version:local.version,independent_approval:true,self_approval_refused:true,idempotent_merge:true,cloud_and_rust_merge_identity_equal:true,exact_crlf_restored:true,native_versions:4,paid_containers:0};await writeFile(join(root,'validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
 if(account)await api(account,'/v1/auth/logout',{method:'POST'});
 const url=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/3f86b3ae-8ed7-4592-b875-c0db6e69c381/query`;
 for(const table of ['native_sessions','native_project_members','native_users']){const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},body:JSON.stringify({sql:`DELETE FROM ${table} WHERE username=?`,params:[username]})});assert(response.ok,'temporary account cleanup failed');const result=await response.json();assert(result.success,'temporary account cleanup rejected');}
}
