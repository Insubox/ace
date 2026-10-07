// Passwords are read only from an interactive terminal and never echoed.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loginSession } from './account-session.mjs';
const {values}=parseArgs({options:{output:{type:'string'},origin:{type:'string'}}});
let terminal;
try{
  if(!values.output)throw new Error('Usage: node cloud/scripts/account-login.mjs --output /private/path/ace-session.json [--origin https://your-ace.workers.dev]');
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Use an interactive terminal to keep the password hidden');
  let muted=false;const sink=new Writable({write(chunk,_encoding,done){if(!muted)process.stdout.write(chunk);done();}});
  terminal=createInterface({input:process.stdin,output:sink,terminal:true});
  terminal.on('SIGINT',()=>{terminal.close();process.exitCode=1;});
  const username=await terminal.question('ACE username: ');
  process.stdout.write('ACE password (hidden): ');muted=true;
  const password=await terminal.question('');terminal.close();process.stdout.write('\n');
  const result=await loginSession({origin:values.origin??process.env.ACE_API_URL??'',username,password,output:values.output});
  console.log(JSON.stringify(result,null,2));
}catch(error){terminal?.close();process.stderr.write(`ACE sign-in: ${error.message}\n`);process.exitCode=1;}
