// Real Chromium regression: changing projects must not invalidate authentication.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const html=await readFile(process.env.ACE_DASHBOARD_HTML??'cloud/src/dashboard.html','utf8');
const credential='isolated-project-session-token';
let mode='switch',loginCalls=0,firstStarted=false,meStarted=false;
const releases=[];
const hold=()=>new Promise(resolve=>releases.push(resolve));
const release=()=>{while(releases.length)releases.shift()();};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/'){res.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'none'; script-src 'nonce-ace-native-dashboard-v1'; style-src 'nonce-ace-native-dashboard-v1'; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});return res.end(html);}
 if(path==='/v1/auth/browser-login'){loginCalls++;if(mode!=='invalid')res.setHeader('set-cookie','ace_fixture_session='+credential+'; Path=/; HttpOnly; SameSite=Strict');return send(mode==='invalid'?401:200,{});}
 if(path==='/v1/auth/browser-logout'){res.setHeader('set-cookie','ace_fixture_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send(200,{});}
 if(req.headers.authorization!=='Bearer '+credential&&!(req.headers.cookie??'').includes('ace_fixture_session='+credential))return send(401,{});
 if(path==='/v1/auth/logout')return send(200,{});
 if(path==='/v1/auth/me'){if(mode==='logout'){meStarted=true;await hold();}return send(200,{kind:'account',username:'fixture-owner',role:'writer'});}
 if(path==='/v1/stores')return send(200,{stores:[]});
 if(path==='/v1/projects')return send(200,{projects:['first','second'].map(name=>({name,role:'owner'}))});
 if(path==='/v1/stores/first'){firstStarted=true;if(mode==='switch')await hold();if(mode==='failure')return send(503,{});}
 if(/^\/v1\/stores\/(first|second)$/.test(path))return send(200,{schema_version:1,entries:[],tip:null});
 if(path.endsWith('/refs'))return send(200,{schema_version:1,heads:{},events:[],tip:null});
 if(path.endsWith('/issues'))return send(200,{issues:[]});
 if(path.endsWith('/notifications'))return send(200,{events:[],unread_count:0,through:0});
 if(path.endsWith('/trials'))return send(200,{trials:[]});
 if(path.endsWith('/reviews'))return send(200,{reviews:[]});
 if(path.endsWith('/application-campaigns'))return send(200,{campaigns:[]});
 if(path.endsWith('/applications'))return send(200,{runs:[]});
 return send(404,{});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const target=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.type==='page');assert(target);
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let next=0;const pending=new Map(),exceptions=[];
socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true});assert(!result.exceptionDetails);return result.result.value;};
const until=async condition=>{for(let i=0;i<160;i++){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Browser condition timed out');};
const wait=expression=>until(()=>evaluate("document.readyState==='complete'&&("+expression+")"));
const signIn=async(operator=false)=>{await call('Network.clearBrowserCookies');await call('Page.navigate',{url:origin});await wait("document.getElementById('account-login')&&!document.getElementById('auth').hidden");await evaluate(operator?`document.getElementById('token').value=${JSON.stringify(credential)};document.getElementById('login-form').requestSubmit()`:"document.getElementById('username').value='fixture-owner';document.getElementById('password').value='fixture-password-1234';document.getElementById('account-login').requestSubmit()");};
const switchProject=()=>evaluate("document.getElementById('project-picker').value='second';document.getElementById('project-picker').dispatchEvent(new Event('change'))");
const ready=()=>wait("!document.getElementById('workspace').hidden&&document.getElementById('project-picker').value==='second'&&document.getElementById('status').textContent.includes('native versions loaded')");
let secondSocket,secondTarget;
try{
 await call('Runtime.enable');await call('Page.enable');
 for(const operator of [false,true]){
  mode='switch';firstStarted=false;const count=loginCalls;await signIn(operator);await until(()=>firstStarted);await switchProject();await ready();release();
  assert.equal(loginCalls-count,operator?0:1);assert.equal(await evaluate("document.getElementById('auth').hidden"),true);
  // The authenticated token continues to authorize a fresh project refresh.
  await evaluate("document.getElementById('refresh').click()");await ready();
  await evaluate("document.getElementById('logout').click()");await wait("document.getElementById('workspace').hidden&&document.getElementById('project-picker').options.length===0");
 }
 mode='failure';await signIn();await wait("document.getElementById('status').textContent.includes('(503)')");assert.equal(await evaluate("document.getElementById('auth').hidden"),true);await switchProject();await ready();
 mode='logout';meStarted=false;await signIn();await until(()=>meStarted);await evaluate("document.getElementById('logout').click()");release();await wait("!document.getElementById('account-login').querySelector('button').disabled");assert.equal(await evaluate("document.getElementById('workspace').hidden&&document.getElementById('project-picker').options.length===0"),true);
 mode='invalid';await signIn();await wait("document.getElementById('status').textContent.includes('Username or password was not accepted')");assert.equal(await evaluate("document.getElementById('workspace').hidden"),true);
 mode='persistent';const before=loginCalls;await signIn();await wait("!document.getElementById('workspace').hidden&&document.getElementById('status').textContent.includes('native versions loaded')");assert.equal(await evaluate('document.cookie'),'');const beforeReload=await evaluate('performance.timeOrigin');await call('Page.reload');await wait("performance.timeOrigin!=="+beforeReload+"&&!document.getElementById('workspace').hidden&&document.getElementById('status').textContent.includes('native versions loaded')");assert.equal(loginCalls-before,1);
 secondTarget=(await call('Target.createTarget',{url:origin})).targetId;const second=(await(await fetch('http://127.0.0.1:9222/json/list')).json()).find(t=>t.id===secondTarget);assert(second);secondSocket=new WebSocket(second.webSocketDebuggerUrl);await new Promise(resolve=>secondSocket.onopen=resolve);let secondNext=0;const secondPending=new Map();secondSocket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=secondPending.get(m.id);secondPending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}};const secondCall=(method,params={})=>new Promise((resolve,reject)=>{const id=++secondNext;secondPending.set(id,{resolve,reject});secondSocket.send(JSON.stringify({id,method,params}));});const secondEvaluate=async expression=>(await secondCall('Runtime.evaluate',{expression,returnByValue:true})).result.value;
 await until(()=>secondEvaluate("document.getElementById('workspace')&&!document.getElementById('workspace').hidden"));assert.equal(loginCalls-before,1);await evaluate("document.getElementById('logout').click()");await wait("document.getElementById('workspace').hidden&&!document.getElementById('account-login').querySelector('button').disabled");await until(()=>secondEvaluate("document.getElementById('workspace').hidden"));await secondCall('Page.reload');await until(()=>secondEvaluate("document.getElementById('account-login')&&!document.getElementById('auth').hidden"));assert.equal(loginCalls-before,1);
 assert.equal(exceptions.length,0,JSON.stringify(exceptions.map(e=>({text:e.text,message:e.exception?.description}))));
 console.log(JSON.stringify({browser:'Chromium',account_project_switch:true,operator_project_switch:true,project_failure_preserves_session:true,late_auth_cannot_undo_logout:true,invalid_login_rejected:true,reload_preserves_session:true,new_tab_restores_session:true,http_only_cookie:true,logout_clears_other_tabs:true,production_mutations:0}));
}finally{release();if(secondTarget)await call('Target.closeTarget',{targetId:secondTarget});secondSocket?.close();socket.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
