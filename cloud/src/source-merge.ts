// Same bounded line/LCS semantics as the native Rust engine; never execute source.
import {HttpError} from './contracts';
export type Edit={start:number;end:number;lines:string[]};
export function lines(bytes:Uint8Array):string[]|null{
 if(bytes.length>65536)return null;
 try{const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),result=text.match(/[^\n]*\n|[^\n]+$/g)??[];return result.length<=256?result:null;}catch{return null;}
}
export function edits(base:string[],changed:string[]):Edit[]{
 const widths=changed.length+1,lengths=new Uint16Array((base.length+1)*widths);
 for(let i=base.length-1;i>=0;i--)for(let j=changed.length-1;j>=0;j--)lengths[i*widths+j]=base[i]===changed[j]?lengths[(i+1)*widths+j+1]!+1:Math.max(lengths[(i+1)*widths+j]!,lengths[i*widths+j+1]!);
 let i=0,j=0,pending:Edit|undefined;const result:Edit[]=[];
 while(i<base.length||j<changed.length){if(i<base.length&&j<changed.length&&base[i]===changed[j]){if(pending){result.push(pending);pending=undefined;}i++;j++;}else{pending??={start:i,end:i,lines:[]};if(j<changed.length&&(i===base.length||lengths[i*widths+j+1]!>=lengths[(i+1)*widths+j]!))pending.lines.push(changed[j++]!);else pending.end=++i;}}
 if(pending)result.push(pending);return result;
}
export function mergeText(base:Uint8Array,ours:Uint8Array,theirs:Uint8Array):Uint8Array|null{
 const b=lines(base),o=lines(ours),t=lines(theirs);if(!b||!o||!t)return null;const left=edits(b,o);
 for(const incoming of edits(b,t)){if(left.some(e=>e.start===incoming.start&&e.end===incoming.end&&JSON.stringify(e.lines)===JSON.stringify(incoming.lines)))continue;
 if(left.some(e=>e.start===e.end||incoming.start===incoming.end?e.start<=incoming.end&&incoming.start<=e.end:e.start<incoming.end&&incoming.start<e.end))return null;left.push(incoming);}
 left.sort((a,b)=>a.start-b.start||a.end-b.end);let cursor=0;const result:string[]=[];for(const e of left){result.push(...b.slice(cursor,e.start),...e.lines);cursor=e.end;}result.push(...b.slice(cursor));return new TextEncoder().encode(result.join(''));
}
export function mergeBase(parents:Map<string,string[]>,ours:string,theirs:string,explicit?:string){
 const ancestors=(id:string)=>{const seen=new Set<string>(),next=[id];while(next.length){const id=next.pop()!;if(seen.has(id))continue;const ps=parents.get(id);if(!ps)throw new HttpError(409,'merge ancestry is unpublished');seen.add(id);next.push(...ps);}return seen;};
 const a=ancestors(ours),b=ancestors(theirs),common=[...a].filter(id=>b.has(id));
 if(explicit){if(!common.includes(explicit))throw new HttpError(409,'merge base must be an ancestor of both versions');return explicit;}
 const lowest=common.filter(id=>!common.some(other=>other!==id&&ancestors(other).has(id)));if(lowest.length!==1)throw new HttpError(409,'merge requires one common ancestor; provide an explicit base');return lowest[0]!;
}
