// A local development server for the three public examples. No cloud credentials.
import {createServer} from 'node:http';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=await realpath(resolve(process.argv[2]??''));
if(!process.argv[2])throw new Error('Pass the application project directory');
const paths=new Map([['/','web/index.html'],['/style.css','web/style.css'],['/app.js','web/app.js'],['/src/core.js','src/core.js'],['/node_modules/decimal.js/decimal.js','node_modules/decimal.js/decimal.js']]);
// index links resolve from /web/; keep both the page URL and relative routes.
paths.set('/web/index.html','web/index.html');paths.set('/web/app.js','web/app.js');paths.set('/web/style.css','web/style.css');
const server=createServer(async(req,res)=>{let directories=[],file;try{
 if(req.method!=='GET')throw new Error('GET only');const path=paths.get(new URL(req.url,'http://127.0.0.1').pathname);if(!path)throw new Error('unknown path');
 if(process.platform==='linux'){let parent=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);directories.push(parent);const parts=path.split('/');for(const part of parts.slice(0,-1)){parent=await open('/proc/self/fd/'+parent.fd+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);directories.push(parent);}file=await open('/proc/self/fd/'+parent.fd+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}else{const destination=await realpath(join(root,path));if(!destination.startsWith(root+'/'))throw new Error('path outside project');file=await open(destination,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 const stat=await file.stat();if(!stat.isFile()||stat.size>196608)throw new Error('oversized or special file');const bytes=Buffer.alloc(196609);let size=0;while(size<bytes.length){const result=await file.read(bytes,size,bytes.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}if(size>196608)throw new Error('file grew beyond limit');
 res.writeHead(200,{'content-type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(bytes.subarray(0,size));
 }catch{res.writeHead(404);res.end('Example file unavailable. Run npm ci in the project first.');}finally{await file?.close();for(const directory of directories.reverse())await directory.close();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));console.log('Open http://127.0.0.1:'+server.address().port+'/web/index.html');
