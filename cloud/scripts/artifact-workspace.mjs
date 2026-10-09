import {parseArgs} from 'node:util';
import {settings} from './client.mjs';
import {loadSession} from './account-session.mjs';
import {prepareWorkspace,proposeWorkspace} from './artifact-workspace-driver.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{project:{type:'string'},workspace:{type:'string'},directory:{type:'string'},session:{type:'string'},resume:{type:'boolean',default:false}}});
try{
 if(positionals.length!==1||!['prepare','propose'].includes(positionals[0])||!values.directory)throw Error('Usage: artifact-workspace.mjs prepare --project NAME --workspace UUID --directory NEW_FOLDER [--session FILE]; or propose --directory FOLDER [--session FILE]');
 const config=values.session?await loadSession(values.session):settings();
 const result=positionals[0]==='prepare'?await prepareWorkspace({config,project:values.project,workspace:values.workspace,directory:values.directory,resume:values.resume}):await proposeWorkspace({config,directory:values.directory});console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
