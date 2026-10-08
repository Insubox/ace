// Reproducible controlled defects and repair-policy ablation, with real builds.
import assert from 'node:assert/strict';import {parseArgs} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import templates from '../applications/templates.json' with {type:'json'};
import {runTask} from './lib/application-task.mjs';
import {strictTypeLearning,chooseWithLearning} from './lib/application-learning.mjs';
const {values}=parseArgs({options:{output:{type:'string'},ace:{type:'string',default:'target/debug/ace'},image:{type:'string',default:'ace-applications:local'}}});
assert(values.output,'Choose --output fresh-directory; prepare the existing offline application image first');
const root=resolve(values.output),binary=resolve(values.ace),store=join(root,'native');await mkdir(root,{mode:0o700});
const input=async(name,files)=>{const path=join(root,name);await mkdir(path);for(const [p,b]of Object.entries(files))await writeFile(join(path,p),b,{mode:0o600});return path;};
const tasks=[];
for(const profile of ['hello-world','tictactoe','calculator']){
 const files={...templates[profile]},good=files['core.py'];
 files['core.py']=profile==='hello-world'?good.replace('"Hello, "','"Hi, "'):profile==='tictactoe'?good.replace('type(cell) is not int','not isinstance(cell, int)'):good.replace('type(a) not in (int, float) or type(b) not in (int, float)','not isinstance(a, (int, float)) or not isinstance(b, (int, float))');assert.notEqual(files['core.py'],good);
 const proposals=[{strategy:'Invalid dependency edit, recorded as a generator fault',files:{'dependencies.lock.json':'invalid'}},{strategy:'Intentionally incorrect proposal, retained as negative evidence',files:{'core.py':'def handle(request):\n    return {"result": 999}\n'}},{strategy:'Declared curated repair of the greeting or strict-type defect',files:{'core.py':good}}];
 const {summary}=await runTask({profile,baseline:await input(profile+'-input',files),proposals,output:join(root,profile),binary,image:values.image,agent:'curated-codex-fixtures',store});
 assert(summary.baseline.passed<summary.baseline.total);assert.equal(summary.best.passed,summary.best.total);assert.equal(summary.rounds[0].status,'generator_fault');assert.equal(summary.rounds[1].accepted,false);assert.equal(summary.rounds[2].accepted,true);tasks.push(summary);console.log(JSON.stringify({profile,before:summary.baseline.passed,after:summary.best.passed,total:summary.best.total}));
}
const training=tasks.find(t=>t.profile==='tictactoe'),memory=await strictTypeLearning({store,failure:training.baseline.version,success:training.best.version,image:training.image_hash,binary}),pairs=[];
for(const profile of ['hello-world','calculator']){
 const files={...templates[profile]},good=files['core.py'];files['core.py']=profile==='hello-world'?good.replace('    if not isinstance(name, str)','    if isinstance(name, bool): name = str(name)\n    if not isinstance(name, str)'):good.replace('type(a) not in (int, float) or type(b) not in (int, float)','not isinstance(a, (int, float)) or not isinstance(b, (int, float))');
 const baseline=await input(profile+'-fresh-input',files),pool=[{recipe:'retain-coercion',strategy:'Uninformed first proposal preserves permissive types',files:{'core.py':files['core.py']+'\n# same semantics\n'}},{recipe:'strict-boolean-input-validation',strategy:'Evidence selects strict validation where the target contract requires it',files:{'core.py':good}}],results=[];
 for(const [arm,proposal]of [['without', {strategy:pool[0].strategy,files:pool[0].files}],['with',chooseWithLearning(memory,profile,pool)]]){const {summary}=await runTask({profile,baseline,proposals:[proposal],output:join(root,profile+'-'+arm),binary,image:values.image,agent:'curated-retrieval-policy',store});results.push(summary);}
 const [without,withMemory]=results;assert.equal(without.baseline.source_hash,withMemory.baseline.source_hash);assert.equal(without.suite_hash,withMemory.suite_hash);assert.equal(without.image_hash,withMemory.image_hash);assert(withMemory.best.passed>without.best.passed);pairs.push({profile,budget_per_arm:1,without_memory:without,with_memory:withMemory,gain:withMemory.best.passed-without.best.passed});
}
const report={schema_version:1,tasks,memory,pairs,paid_cloud_calls:0,scope:'Controlled defects, curated declared proposals and repair pool. Actual independent offline compilation and testing. Demonstrates bounded task improvements and this retrieval policy, not general model learning or hosted qualification.'};await writeFile(join(root,'comparison.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({complete_tasks:3,learning_pairs:2,paid_cloud_calls:0,report:join(root,'comparison.json')}));
