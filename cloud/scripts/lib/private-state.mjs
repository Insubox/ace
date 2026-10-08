import {open,rename,link,unlink} from 'node:fs/promises';import {constants} from 'node:fs';import {randomUUID} from 'node:crypto';
const safe=async file=>{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||(process.getuid&&stat.uid!==process.getuid()))throw Error('State must be an owned regular file with one link');return stat;};
export async function readPrivateState(path){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await safe(file);if(stat.mode&0o077||stat.size>1048576)throw Error('State must be private and at most 1 MiB');const bytes=Buffer.alloc(1048577);const {bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead>1048576)throw Error('State exceeds 1 MiB');return JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));}finally{await file.close();}}
export async function writePrivateState(path,state,{create=false}={}){
 const bytes=JSON.stringify(state,null,2);if(Buffer.byteLength(bytes)>1048576)throw Error('State exceeds 1 MiB');
 if(!create){let existing;try{existing=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);await safe(existing);}catch(error){if(error.code!=='ENOENT')throw error;}finally{await existing?.close();}}
 const pending=path+'.pending-'+randomUUID(),file=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}if(create){await link(pending,path);await unlink(pending);}else await rename(pending,path);}
 finally{try{await unlink(pending);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
