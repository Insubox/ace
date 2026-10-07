// Optional real-browser check. Start Chromium with --remote-debugging-port=9222.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';

const pageUrl = process.argv[2].startsWith('http://127.0.0.1:')
  ? process.argv[2] : pathToFileURL(resolve(process.argv[2])).href;
const port = Number(process.argv[3] ?? 9222);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page');
assert(target, 'Chromium must expose a page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => { socket.onopen=done; socket.onerror=reject; });
let nextId=0; const pending=new Map(), exceptions=[], requests=[];
socket.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.reject(new Error(message.error.message));else p.resolve(message.result);}
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);
  if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);
};
const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},10000);
  pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
  socket.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=>{
  const result=await call('Runtime.evaluate',{expression,returnByValue:true});
  assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
};
try {
  await call('Runtime.enable');await call('Network.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:1050,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:pageUrl});
  for(let i=0;i<20;i++){if(await evaluate("document.querySelectorAll('#rows tr').length===13"))break;await new Promise(r=>setTimeout(r,250));}
  assert.equal(await evaluate("document.querySelectorAll('#rows tr').length"),13);
  assert.equal(await evaluate("document.getElementById('counts').textContent"),'10 / 0 / 3');
  assert.match(await evaluate("document.getElementById('detail').textContent"),/\(module/);
  assert.match(await evaluate("document.getElementById('report-hash').textContent"),/[0-9a-f]{64}/);
  await evaluate("document.getElementById('filter').value='failed';document.getElementById('filter').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#rows tr').length"),3);
  await evaluate("[...document.querySelectorAll('.candidate')].find(b=>b.textContent==='C-control-add').click();document.querySelector('[data-tab=evaluation]').click()");
  const evaluation=JSON.parse(await evaluate("document.getElementById('detail').textContent"));
  assert.equal(evaluation.outcome,'failed_correctness');
  await evaluate("document.querySelector('[data-tab=evidence]').click()");
  assert.match(await evaluate("document.getElementById('detail').textContent"),/content_hash/);
  await evaluate("document.querySelector('[data-tab=decision]').click()");
  assert.match(await evaluate("document.getElementById('detail').textContent"),/kill/);
  await evaluate("document.getElementById('search').value='missing-candidate';document.getElementById('search').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#rows tr').length"),0);
  await evaluate("document.getElementById('search').value='';document.getElementById('filter').value='all';document.getElementById('search').dispatchEvent(new Event('input'));document.querySelector('.candidate').click();document.querySelector('[data-tab=source]').click()");
  assert.deepEqual(exceptions,[]);assert(requests.every(url=>url===pageUrl),JSON.stringify(requests));
  if(process.argv[4]){const screenshot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(process.argv[4]),Buffer.from(screenshot.data,'base64'));}
  console.log(JSON.stringify({browser:'Chromium',programs:13,qualified:10,failures:3,filters:true,candidate_detail:true,evidence:true,policy:true,network_requests:0}));
} finally {socket.close();}
