// Optional Chromium check against deployed read-only data. Real credentials stay
// in Node; browser account mutations use an isolated transport fixture only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { settings,api } from '../cloud/scripts/client.mjs';

const config=settings(),name=process.argv[2]??'native-platform-v030';
assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name));
const deployed=await fetch(config.origin,{redirect:'error'});
assert.equal(deployed.status,200);
const html=await deployed.text();
const fixtureToken='browser-fixture-not-a-production-credential';
const setupCode='0'.repeat(64),password='isolated-browser-test-password';
let setupCalls=0,createCalls=0,role='admin',liveReads=0;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(req.method==='GET'&&['/','/setup'].includes(url.pathname)){
      res.writeHead(200,{'content-type':'text/html',
        'content-security-policy':deployed.headers.get('content-security-policy'),'cache-control':'no-store'});
      return res.end(html);
    }
    let input='';for await(const chunk of req){input+=chunk;if(input.length>16384)throw new Error('Fixture input limit');}
    if(req.method==='POST'&&url.pathname==='/v1/auth/setup'){
      setupCalls++;const args=JSON.parse(input);assert.equal(args.code,setupCode);assert.equal(args.username,'fixture-admin');assert.equal(args.password,password);
      return send(201,{created:true,username:args.username,role:'admin'});
    }
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
    // Only read deployed store data. No production account or source is mutated.
    if(req.method==='GET'&&(url.pathname==='/v1/stores'||url.pathname.startsWith(`/v1/stores/${name}`))){
      liveReads++;const response=await api(config,url.pathname,{signal:AbortSignal.timeout(30000)});
      res.writeHead(200,{'content-type':response.headers.get('content-type')});return res.end(Buffer.from(await response.arrayBuffer()));
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
let next=0;const pending=new Map(),exceptions=[];
socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},10000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});assert(!r.exceptionDetails);return r.result.value;};
const until=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,250));}throw new Error(`UI wait failed: ${expression}`);};
const fill=async values=>evaluate(Object.entries(values).map(([id,value])=>`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)}`).join(';'));
const submit=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).requestSubmit()`);
try{
  await call('Runtime.enable');await call('Page.enable');
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
  await evaluate(`[...document.querySelectorAll('.store')].find(n=>n.textContent.startsWith(${JSON.stringify(name+' ·')})).click()`);
  await until("document.getElementById('versions').children.length===6&&document.getElementById('status').textContent.startsWith('Verified object')");
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
  if(process.argv[4])await writeFile(process.argv[4],Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.getElementById('logout').click()");await until("document.getElementById('workspace').hidden");
  await fill({username:'fixture-reader',password});await submit('account-login');await until("!document.getElementById('workspace').hidden");
  assert.equal(await evaluate("document.getElementById('account-admin').hidden"),true);
  assert.deepEqual(exceptions,[]);
  console.log(JSON.stringify({browser:'Chromium',deployed_html:true,deployed_native_versions:6,deployed_read_requests:liveReads,source_hash_verified:true,inert_source:true,setup_fragment_removed:true,account_forms:'isolated_fixture_only',password_confirmation:true,admin_and_reader_views:true,production_mutations:0}));
}finally{socket.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
