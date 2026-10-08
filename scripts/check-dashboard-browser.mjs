// Optional Chromium check against deployed read-only data. Real credentials stay
// in Node; browser account mutations use an isolated transport fixture only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile,readFile } from 'node:fs/promises';
import {nativeHash} from '../cloud/scripts/native-wire.mjs';
import { settings,api } from '../cloud/scripts/client.mjs';

const config=settings(),name=process.argv[2]??'native-platform-v030';
assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name));
const deployed=await fetch(config.origin,{redirect:'error'});
assert.equal(deployed.status,200);
const html=process.env.ACE_DASHBOARD_HTML?await readFile(process.env.ACE_DASHBOARD_HTML,'utf8'):await deployed.text();
const deployedCsp=deployed.headers.get('content-security-policy');
const csp=process.env.ACE_DASHBOARD_HTML?deployedCsp.replace(/(?:font-src data:; )?connect-src/,"font-src data:; connect-src"):deployedCsp;
assert.match(csp,/font-src data:/);
const fixtureToken='browser-fixture-not-a-production-credential';
const setupCode='0'.repeat(64),password='isolated-browser-test-password';
let projectCalls=0,proposalCalls=0,createdProject=false,submittedProposal=null;
let setupCalls=0,createCalls=0,recoveryCalls=0,memberCalls=0,branchCalls=0,branchFixture={schema_version:1,events:[],heads:{},tip:null},role='admin',liveReads=0,corruptObjects=false;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.method==='GET'&&['/','/setup','/recover'].includes(url.pathname)){
      res.writeHead(200,{'content-type':'text/html',
        'content-security-policy':csp,'cache-control':'no-store'});
      return res.end(html);
    }
    let input='';for await(const chunk of req){input+=chunk;if(input.length>16384)throw new Error('Fixture input limit');}
    if(req.method==='POST'&&url.pathname==='/v1/auth/setup'){
      setupCalls++;const args=JSON.parse(input);assert.equal(args.code,setupCode);assert.equal(args.username,'fixture-admin');assert.equal(args.password,password);
      return send(201,{created:true,username:args.username,role:'admin'});
    }
    if(req.method==='POST'&&url.pathname==='/v1/auth/recover'){const args=JSON.parse(input);assert.equal(args.code,setupCode);assert.equal(args.username,'fixture-admin');assert.equal(args.password,password);recoveryCalls++;return send(200,{recovered:true,sessions_revoked:true});}
    if(req.method==='POST'&&url.pathname==='/v1/auth/login'){
      const args=JSON.parse(input);if(args.password!==password)return send(401,{error:'invalid username or password'});
      role=args.username==='fixture-reader'?'reader':'admin';return send(200,{token:fixtureToken});
    }
    if(req.headers.authorization!==`Bearer ${fixtureToken}`)return send(401,{error:'unauthorized'});
    if(url.pathname==='/v1/auth/me')return send(200,{username:`fixture-${role}`,role,kind:'account'});
    if(req.method==='POST'&&url.pathname==='/v1/auth/logout')return send(200,{signed_out:true});
    if(req.method==='POST'&&url.pathname==='/v1/users'){
      assert.equal(role,'admin');const args=JSON.parse(input);assert.equal(args.role,'reader');assert.equal(args.password,password);createCalls++;
      return send(201,{created:true,username:args.username,role:args.role});
    }
    if(url.pathname===`/v1/users/fixture-reader/recovery`&&req.method==='POST')return send(200,{path:`/recover#recover=${setupCode}&user=fixture-reader`});
    if(url.pathname==='/v1/auth/audit')return send(200,{events:[{recorded_at:Date.now(),actor:'account:fixture-admin',action:'recovery.issue',username:'fixture-reader'}]});
    if(url.pathname==='/v1/projects'&&req.method==='POST'){assert.equal(role,'admin');assert.equal(JSON.parse(input).name,'browser-created');createdProject=true;projectCalls++;return send(201,{name:'browser-created'});}
    if(url.pathname==='/v1/projects'&&req.method==='GET')return send(200,{projects:[{name,role:role==='admin'?'owner':'reader'},...(createdProject?[{name:'browser-created',role:'owner'}]:[])]});
    if(url.pathname==='/v1/stores/browser-created')return send(200,{schema_version:1,entries:[],publishers:{},tip:null});
    if(url.pathname==='/v1/stores/browser-created/refs')return send(200,{schema_version:1,events:[],heads:{},tip:null});
    if(url.pathname==='/v1/projects/browser-created/trials')return send(200,{trials:[]});
    if(url.pathname===`/v1/projects/${name}/trials`){if(req.method==='POST'){assert.equal(role,'admin');proposalCalls++;const args=JSON.parse(input);assert.match(args.wat,/i32.rem_u/);if(!submittedProposal){submittedProposal=args;return send(503,{error:'simulated accepted request with interrupted HTTP response'});}assert.deepEqual(args,submittedProposal);return send(202,{id:'trial-'+ 'a'.repeat(64),experiment:'EXP-OBS-browser',status:'completed'});}return send(200,{trials:submittedProposal?[{id:'trial-'+ 'a'.repeat(64),experiment:'EXP-OBS-browser',status:'completed',native_version:'92c2a874f9264edfd80f44b9fd48b82e89c6b416b9b9ed05dfd03267ff991025'}]:[]});}
    if(url.pathname===`/v1/projects/${name}/trials/trial-${'a'.repeat(64)}/proposal`)return send(200,submittedProposal);
    if(url.pathname===`/v1/projects/${name}/audit`)return send(200,{events:[{recorded_at:Date.now(),actor:'account:fixture-admin',action:'member.grant',resource:'fixture-reader:reader'}]});
    if(url.pathname===`/v1/projects/${name}/members`){if(req.method==='POST'){assert.equal(role,'admin');memberCalls++;}return send(200,{members:[{username:'fixture-admin',role:'owner'},{username:'fixture-reader',role:'reader'}]});}
    if(url.pathname===`/v1/stores/${name}/refs`){if(req.method==='POST'){assert.equal(role,'admin');const args=JSON.parse(input);assert.equal(args.branch,'browser-branch');assert.equal(args.expected,null);assert.equal(args.content_hash,nativeHash([1,args.sequence,args.previous,args.branch,args.expected,args.target]));branchCalls++;branchFixture={schema_version:1,events:[args],heads:{[args.branch]:args.target},tip:args.content_hash};}return send(200,branchFixture);}
    if(req.method==='GET'&&/^\/v1\/stores\/[^/]+\/reviews$/.test(url.pathname))return send(200,{reviews:[]});
    if(req.method==='GET'&&url.pathname.endsWith('/application-campaigns'))return send(200,{campaigns:[]});
    if(req.method==='GET'&&/^\/v1\/projects\/[^/]+\/applications$/.test(url.pathname))return send(200,{runs:[]});
    // Only read deployed store data. No production account or source is mutated.
    if(req.method==='GET'&&(url.pathname==='/v1/stores'||url.pathname.startsWith(`/v1/stores/${name}`))){
      liveReads++;const response=await api(config,url.pathname,{signal:AbortSignal.timeout(30000)});
      if(url.pathname==='/v1/stores'){const data=await response.json();data.stores=data.stores.filter(s=>s.name===name);for(const store of data.stores)store.project_role=role==='admin'?'owner':'reader';return send(200,data);}
      res.writeHead(200,{'content-type':response.headers.get('content-type')});return res.end(corruptObjects&&url.pathname.includes('/objects/')?Buffer.from('corrupted fixture bytes'):Buffer.from(await response.arrayBuffer()));
    }
    send(404,{error:'fixture route not found'});
  }catch{res.writeHead(500);res.end('Fixture failed');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
const targets=await(await fetch(`http://127.0.0.1:${process.argv[3]??9222}/json/list`)).json();
const target=targets.find(t=>t.type==='page');assert(target);
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=reject;});
let next=0;const pending=new Map(),exceptions=[],violations=[];
socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.source==='security')violations.push(m.params.entry.text);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},10000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});assert(!r.exceptionDetails);return r.result.value;};
const until=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,250));}throw new Error(`UI wait failed: ${expression}`);};
const fill=async values=>evaluate(Object.entries(values).map(([id,value])=>`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)}`).join(';'));
const submit=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).requestSubmit()`);
try{
  await call('Runtime.enable');await call('Page.enable');await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:1050,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${origin}/setup#setup=${setupCode}`});
  await until("document.getElementById('bootstrap')&&!document.getElementById('bootstrap').hidden");
  assert.equal(await evaluate('location.hash'),'');
  await fill({'setup-user':'fixture-admin','setup-password':password,'setup-confirm':'different-password'});await submit('bootstrap-form');
  await until("document.getElementById('setup-result').textContent.includes('must match')");assert.equal(setupCalls,0);
  await fill({'setup-confirm':password});await submit('bootstrap-form');
  await until("document.getElementById('setup-result').textContent.includes('was created')");assert.equal(setupCalls,1);
  assert.equal(await evaluate("document.getElementById('setup-password').value"),'');
  await fill({password});await submit('account-login');
  await until("!document.getElementById('workspace').hidden");
  assert.equal(await evaluate("document.getElementById('account-admin').hidden"),false);
  await evaluate("document.querySelector('#account-admin details').open=true");
  await fill({'new-user':'fixture-reader','new-password':password,'new-confirm':password});
  await evaluate("document.getElementById('new-role').value='reader'");await submit('create-user');
  await until("document.getElementById('account-result').textContent.includes('created with reader')");assert.equal(createCalls,1);
  await until("document.getElementById('versions').children.length===6&&document.getElementById('status').textContent.includes('native versions loaded')");
  assert.equal(await evaluate("document.getElementById('stat-versions').textContent"),'6');
  assert.equal(await evaluate("document.getElementById('stat-candidates').textContent"),'18');
  assert.equal(await evaluate("document.getElementById('stat-faults').textContent"),'1');
  await evaluate("document.getElementById('team-toggle').click()");await until("document.getElementById('members').children.length===2");
  await fill({'member-user':'fixture-reader'});await submit('grant-member');await until("document.getElementById('team-result').textContent.includes('saved')");assert.equal(memberCalls,1);
  await fill({'recovery-user':'fixture-reader'});await submit('issue-recovery');await until("!document.getElementById('recovery-link').hidden");
  await evaluate("document.getElementById('team-toggle').click();document.querySelector('#account-admin details').open=false");
  if(process.argv[4])await writeFile(process.argv[4],Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.getElementById('nav-learning').click()");
  assert.match(await evaluate("document.getElementById('learning-claims').textContent"),/Rejected strategies/);
  await evaluate("document.getElementById('nav-trials').click();document.querySelector('#objectives [data-version=\"92c2a874f9264edfd80f44b9fd48b82e89c6b416b9b9ed05dfd03267ff991025\"]').click()");
  if(process.env.ACE_EXPECT_SERVER_VERIFICATION==='1'){await until("document.getElementById('server-verification').textContent.includes('reproduced')");await evaluate("document.getElementById('verified-run').click()");assert.match(await evaluate("document.getElementById('server-receipt').textContent"),/verified_environment_hash/);}
  await evaluate("document.querySelector('button[data-candidate=\"C-agent-recursive\"]').click()");
  await until("document.getElementById('candidate-heading').textContent==='C-agent-recursive'&&!document.getElementById('candidate-download').hidden");
  assert.match(await evaluate("document.getElementById('candidate-detail').textContent"),/module/);
  assert.equal(await evaluate("document.getElementById('candidate-outcome').textContent"),'QUALIFIED');
  await evaluate("document.querySelector('button[data-candidate=\"C-agent-add\"]').click()");
  await until("!document.getElementById('candidate-download').hidden");
  assert.match(await evaluate("document.getElementById('candidate-detail').textContent"),/module/);
  assert.equal(await evaluate("document.getElementById('candidate-outcome').textContent"),'FAILED CORRECTNESS');
  await evaluate("document.querySelector('[data-detail=\"evaluation\"]').click()");
  assert.match(await evaluate("document.getElementById('candidate-detail').textContent"),/failed_correctness/);
  await evaluate("document.querySelector('[data-detail=\"evidence\"]').click()");
  assert.match(await evaluate("document.getElementById('candidate-detail').textContent"),/content_hash/);
  if(process.argv[4])await writeFile(process.argv[4].replace(/\.png$/, '-trials.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const tab of ['home','trials','learning','versions']){
    await evaluate(`document.getElementById('nav-${tab}').click()`);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`Mobile overflow in ${tab}`);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:1050,deviceScaleFactor:1,mobile:false});
  await evaluate("document.getElementById('nav-versions').click()");
  await fill({'branch-name':'browser-branch'});await submit('branch-form');await until("document.getElementById('branch-heads').textContent.includes('browser-branch')");assert.equal(branchCalls,1);
  assert.match(await evaluate("document.getElementById('version-count').textContent"),/6 of 6/);
  const sourceVersion='330e16358a8b4299e5b9b8f1ba5ed170813e07c24e9a0de879b4665a9226886f';
  await evaluate(`[...document.querySelectorAll('#versions button')].find(n=>n.textContent===${JSON.stringify(sourceVersion.slice(0,12))}).click()`);
  await until("document.getElementById('status').textContent.startsWith('Verified object')&&document.getElementById('selected-version').textContent==='Version 330e16358a8b'");
  const selected=await evaluate("[...document.getElementById('files').options].map(o=>o.value)");
  for(const path of selected){await evaluate(`document.getElementById('files').value=${JSON.stringify(path)};document.getElementById('files').dispatchEvent(new Event('change'))`);await until("document.getElementById('status').textContent.startsWith('Verified object')");if((await evaluate("document.getElementById('source').textContent")).includes('</script>'))break;}
  assert.match(await evaluate("document.getElementById('source').textContent"),/<\/script><script>globalThis.INJECTED=true<\/script>/);
  assert.equal(await evaluate('globalThis.INJECTED??false'),false);
  assert.equal(await evaluate("document.getElementById('download').hidden"),false);
  await evaluate("document.querySelector('#account-admin details').open=false");
  await evaluate("document.getElementById('new-project-toggle').click()");await fill({'new-project-name':'browser-created'});await submit('new-project-form');await until("document.getElementById('project-picker').value==='browser-created'&&!document.getElementById('proposal-form').hidden&&document.getElementById('status').textContent.includes('native versions loaded')");assert.equal(projectCalls,1);assert.equal(await evaluate("document.getElementById('branch-form').hidden"),true);
  await evaluate(`document.getElementById('project-picker').value=${JSON.stringify(name)};document.getElementById('project-picker').dispatchEvent(new Event('change'))`);await until("document.getElementById('versions').children.length===6&&document.getElementById('status').textContent.includes('native versions loaded')");await evaluate("document.getElementById('nav-trials').click()");
  assert.deepEqual(await evaluate("Array.from(document.getElementById('proposal-cell').options).map(o=>o.value)"),['Gcd','MaxU32','MinU32']);
  for(const cell of ['MaxU32','MinU32']){
    await evaluate(`document.getElementById('proposal-cell').value=${JSON.stringify(cell)};document.getElementById('proposal-cell').dispatchEvent(new Event('change'));document.getElementById('proposal-example').click()`);
    assert.match(await evaluate("document.getElementById('proposal-wat').value"),cell==='MaxU32'?/max_u32.*gt_u/:/min_u32.*lt_u/);
    assert.match(await evaluate("document.getElementById('proposal-contract').textContent"),/unsigned/);
  }
  await evaluate("document.getElementById('proposal-cell').value='Gcd';document.getElementById('proposal-cell').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('proposal-wat').value"),'');
  await evaluate("document.getElementById('proposal-example').click()");await submit('proposal-form');await until("document.getElementById('proposal-result').textContent.includes('safely retry')");await submit('proposal-form');await until("document.getElementById('proposal-result').textContent.includes('accepted')");assert.equal(proposalCalls,2);assert.equal(await evaluate("document.getElementById('proposal-wat').value"),'');
  await evaluate("document.getElementById('logout').click()");await until("document.getElementById('workspace').hidden");
  await fill({username:'fixture-reader',password});await submit('account-login');await until("!document.getElementById('workspace').hidden");
  assert.equal(await evaluate("document.getElementById('account-admin').hidden"),true);await until("document.getElementById('status').textContent.includes('native versions loaded')");assert.equal(await evaluate("document.getElementById('proposal-form').hidden"),true);assert.equal(await evaluate("document.getElementById('new-project-toggle').hidden"),true);
  await until("document.getElementById('status').textContent.includes('native versions loaded')");
  await evaluate("document.getElementById('logout').click()");await until("document.getElementById('workspace').hidden");
  assert.equal(await evaluate("document.getElementById('candidate-detail').textContent"),'');
  assert.equal(await evaluate("document.getElementById('source').textContent"),'');
  corruptObjects=true;
  await fill({username:'fixture-reader',password});await submit('account-login');
  await until("document.getElementById('status').textContent.includes('evaluation record(s) unavailable')");
  assert.equal(await evaluate("document.getElementById('stat-candidates').textContent"),'0');
  assert.equal(await evaluate("document.getElementById('download').hidden"),true);
  assert.equal(await evaluate("document.getElementById('candidate-download').hidden"),true);
  assert.equal(await evaluate("document.getElementById('source').textContent"),'File could not be verified.');
  await call('Page.navigate',{url:`${origin}/recover#recover=${setupCode}&user=fixture-admin`});await until("document.getElementById('recovery')&&!document.getElementById('recovery').hidden");assert.equal(await evaluate('location.hash'),'');
  await fill({'recover-password':password,'recover-confirm':password});await submit('recover-form');await until("document.getElementById('recover-result').textContent.includes('Password updated')");assert.equal(recoveryCalls,1);assert.equal(await evaluate("document.getElementById('recover-password').value"),'');
  assert.deepEqual(exceptions,[]);assert.deepEqual(violations,[]);
  console.log(JSON.stringify({browser:'Chromium',deployed_html:!process.env.ACE_DASHBOARD_HTML,observatory_main_views:6,mobile_layout:true,loaded_observations:18,winning_and_failed_source:true,csp_violations:0,corrupt_objects_refused:true,logout_clears_private_views:true,server_verification:process.env.ACE_EXPECT_SERVER_VERIFICATION==='1',deployed_native_versions:6,deployed_read_requests:liveReads,source_hash_verified:true,inert_source:true,setup_fragment_removed:true,account_forms:'isolated_fixture_only',password_confirmation:true,project_team_form:true,native_branch_form:true,private_project_creation:true,proposal_http_retry:true,reader_cannot_run_trial:true,recovery_fragment_removed:true,recovery_form:true,admin_and_reader_views:true,production_mutations:0}));
}finally{socket.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
