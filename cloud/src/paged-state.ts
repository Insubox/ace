// SQLite Durable Objects cap each value at 128 KiB. Keep large native state
// below that limit, including legacy journals, reviews and task collections.
const encoder=new TextEncoder();
export async function readState<T>(tx:DurableObjectTransaction,key:string):Promise<T|undefined>{
 const pages=await tx.get<number>(key+'-pages');if(pages===undefined)return tx.get<T>(key);
 if(!Number.isInteger(pages)||pages<1||pages>128)throw new Error('invalid state page count');
 const chunks:Uint8Array[]=[];let size=0;for(let i=0;i<pages;i++){const chunk=await tx.get<Uint8Array>(key+'-page-'+i);if(!chunk)throw new Error('native state page missing');chunks.push(chunk);size+=chunk.length;}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)) as T;
}
export async function writeState(tx:DurableObjectTransaction,key:string,value:unknown){
 const bytes=encoder.encode(JSON.stringify(value));if(bytes.length>8388608)throw new Error('native state exceeds 8 MiB');
 const previous=await tx.get<number>(key+'-pages')??0,pages=Math.max(1,Math.ceil(bytes.length/65536));
 for(let i=0;i<pages;i++)await tx.put(key+'-page-'+i,bytes.slice(i*65536,(i+1)*65536));
 for(let i=pages;i<previous;i++)await tx.delete(key+'-page-'+i);
 await tx.put(key+'-pages',pages);await tx.delete(key);
}
