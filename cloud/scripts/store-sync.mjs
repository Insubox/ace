import { parseArgs } from 'node:util';
import { settings } from './client.mjs';
import { loadSession } from './account-session.mjs';
import { pushStore,pullStore,fetchStore,advanceRef } from './store-sync-driver.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{ace:{type:'string',default:'ace'},session:{type:'string'},expect:{type:'string'},'versions-only':{type:'boolean',default:false}}});
const [action,directory,name]=positionals;
if(!(['push','pull','fetch'].includes(action)&&positionals.length===3||action==='advance'&&positionals.length===4))throw new Error('Usage: store-sync.mjs push|pull|fetch <local-directory> <remote-name> [--versions-only] or advance <remote-name> <branch> <target> [--expect hash] [--session private-file] [--ace executable]');
try{const config=values.session?await loadSession(values.session):settings();const result=action==='advance'?await advanceRef({name:directory,branch:name,target:positionals[3],expected:values.expect??null,config}):await({push:pushStore,pull:pullStore,fetch:fetchStore}[action])({directory,name,config,binary:values.ace,refs:!values['versions-only']});console.log(JSON.stringify(result,null,2));}
catch(error){process.stderr.write(`ACE native sync: ${error.message}\n`);process.exitCode=1;}
