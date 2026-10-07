import { parseArgs } from 'node:util';
import { settings } from './client.mjs';
import { loadSession } from './account-session.mjs';
import { pushStore,pullStore } from './store-sync-driver.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{ace:{type:'string',default:'ace'},session:{type:'string'}}});
const [action,directory,name]=positionals;
if(positionals.length!==3||!['push','pull'].includes(action))throw new Error('Usage: node cloud/scripts/store-sync.mjs push|pull <local-directory> <remote-store-name> [--ace /absolute/path/to/ace] [--session /private/path/ace-session.json]');
try{const config=values.session?await loadSession(values.session):settings();const result=await(action==='push'?pushStore:pullStore)({directory,name,config,binary:values.ace});console.log(JSON.stringify(result,null,2));}
catch(error){process.stderr.write(`ACE native sync: ${error.message}\n`);process.exitCode=1;}
