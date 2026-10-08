'use strict';
const {handle}=require('./core.js');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>4096)process.exit(2);});process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(handle(JSON.parse(input)))+'\n');}catch{process.stdout.write(JSON.stringify({error:'invalid_request'})+'\n');}});
