import {createHash} from 'node:crypto';
const order=(a,b)=>{const aa=Array.from(a,c=>c.codePointAt(0)),bb=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]-bb[i];return aa.length-bb.length;};
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort(order).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export const nativeHash=value=>createHash('sha256').update('ace:canonical-json:v1\0'+canonical(value)).digest('hex');
export function validateRefs(log,versions){
 if(log.schema_version!==1||!Array.isArray(log.events)||log.events.length>1024||!log.heads||Array.isArray(log.heads))throw new Error('Unexpected native branch references');
 const heads=Object.create(null);let previous=null;
 for(const [i,event]of log.events.entries()){
  if(Object.keys(event).sort().join(',')!=='branch,content_hash,expected,previous,schema_version,sequence,target'||event.schema_version!==1||event.sequence!==i+1||event.previous!==previous||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(event.branch)||!versions.has(event.target)||event.expected!==(heads[event.branch]??null)||nativeHash([1,event.sequence,event.previous,event.branch,event.expected,event.target])!==event.content_hash)throw new Error('Native branch reference identity, target or expectation changed');
  heads[event.branch]=event.target;previous=event.content_hash;
 }
 if(log.tip!==previous||Object.keys(heads).sort().some(k=>log.heads[k]!==heads[k])||Object.keys(heads).length!==Object.keys(log.heads).length)throw new Error('Native branch heads differ from their reference history');return log;
}
