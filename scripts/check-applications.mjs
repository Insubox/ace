// Functional local checks: real Python compilation/execution, failing source,
// deadlines, source safety, native clone/checkout and immutable input capture.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{ace:{type:'string',default:'target/debug/ace'},image:{type:'string',default:'python:3.11-slim-bookworm'},output:{type:'string'}}});
const binary=resolve(values.ace),root=values.output?resolve(values.output):await mkdtemp(join(tmpdir(),'ace-applications-')),store=join(root,'history');
const ace=args=>JSON.parse(execFileSync(binary,args,{encoding:'utf8',timeout:180000,maxBuffer:2097152}));
assert.equal(JSON.parse(await readFile('applications/executor.json','utf8')),await readFile('applications/executor.py','utf8'));
const embedded=JSON.parse(await readFile('applications/templates.json','utf8'));
for(const [profile,files]of Object.entries(embedded))for(const [path,text]of Object.entries(files))assert.equal(text,await readFile(join('applications/templates',profile,path),'utf8'));
const summary=[];
for(const profile of ['hello-world','tictactoe','calculator']){const directory=join(root,profile);ace(['app','init',profile,directory]);const result=ace(['app','test',directory,'--output',join(root,profile+'-result'),'--store',store,'--image',values.image]);assert.equal(result.report.compiled,true);assert.equal(result.report.status,'passed');assert.equal(result.report.passed,result.report.total);summary.push({profile,cases:result.report.total,version:result.native_version});const copy=join(root,profile+'-checkout');ace(['store','checkout',result.native_version,'--store',store,'--output',copy]);assert.equal(await readFile(join(copy,'core.py'),'utf8'),await readFile(join(directory,'core.py'),'utf8'));}
const calculator=join(root,'calculator');await writeFile(join(calculator,'core.py'),'def handle(request):\n    return {"result": 999}\n');const wrong=ace(['app','test',calculator,'--output',join(root,'wrong-result'),'--store',store,'--image',values.image]);assert.equal(wrong.report.status,'failed');assert.equal(wrong.report.compiled,true);assert(wrong.report.cases.some(c=>!c.passed));
await writeFile(join(calculator,'core.py'),'def handle(:\n');const syntax=ace(['app','test',calculator,'--output',join(root,'syntax-result'),'--store',store,'--image',values.image]);assert.equal(syntax.report.compiled,false);assert.equal(syntax.report.status,'failed');assert.deepEqual(syntax.report.compile_errors,['core.py']);
const hello=join(root,'hello-world');await writeFile(join(hello,'core.py'),'def handle(request):\n    while True: pass\n');const start=Date.now();const timeout=ace(['app','test',hello,'--output',join(root,'timeout-result'),'--store',store,'--image',values.image]);assert.equal(timeout.report.status,'failed');assert(timeout.report.cases.every(c=>['execution_timeout','execution_failed'].includes(c.error)));assert(Date.now()-start<90000);
const cloned=join(root,'clone');ace(['store','clone',store,cloned]);const log=ace(['store','log',cloned]);assert.equal(log.versions.length,6);
const bad=join(root,'bad-lock');ace(['app','init','calculator',bad]);await writeFile(join(bad,'dependencies.lock.json'),JSON.stringify({schema_version:1,runtime:'python3-stdlib-v1',external:['requests'],local:['core.py']}));assert.throws(()=>ace(['app','test',bad,'--output',join(root,'bad-lock-result'),'--image',values.image]),/failed/);
console.log(JSON.stringify({root,applications:summary,negative_cases_retained:true,syntax_error_retained:true,execution_budget_enforced:true,external_dependencies_rejected:true,native_clone_and_checkout:true,versions:6,paid_cloud_calls:0}));
