import {releaseGate} from './release-gate.mjs';
import {nativeHash} from '../native-wire.mjs';
import {api} from '../client.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function checkReleasePlan(plan,config,readVersion,request=api){
 if(plan?.schema_version!==1||!uuid.test(plan.before??'')||!uuid.test(plan.candidate??'')||plan.before===plan.candidate||!uuid.test(plan.review??'')||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(plan.project??'')||! /^[a-z0-9][a-z0-9_-]{0,62}$/.test(plan.worker??''))throw Error('Invalid private release plan');
 const path='/v1/stores/'+plan.project;
 const review=await(await request(config,path+'/reviews/'+plan.review)).json(),refs=await(await request(config,path+'/refs')).json();
 const head=refs.heads?.main;if(!head)throw Error('Release branch missing');
 const source=await(await request(config,path+'/versions/'+head)).json();
 const authorization=releaseGate({review,head,source,evaluation:plan.evaluation,policy:plan.policy});
 if(plan.authorization&&nativeHash(plan.authorization)!==nativeHash(authorization))throw Error('Release authorization changed');
 const uploaded=await readVersion(plan.candidate),bindings=uploaded.resources?.bindings??[],binding=name=>bindings.find(b=>b.name===name&&b.type==='plain_text')?.text;
 if(binding('RELEASE_SOURCE_VERSION')!==head||binding('RELEASE_SOURCE_HASH')!==authorization.source_hash||binding('SPENDING_CONTROL_MODE')!=='enforce'||!bindings.some(b=>b.name==='WORKER_VERSION'&&b.type==='version_metadata'))throw Error('Uploaded Worker does not bind the approved source and spending safeguards');
 const etag=uploaded.resources?.script?.etag;if(!etag||plan.script_etag&&etag!==plan.script_etag)throw Error('Uploaded Worker artifact identity differs');
 return{authorization,script_etag:etag};
}
