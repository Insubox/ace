import {nativeHash} from '../native-wire.mjs';
const hash=/^[a-f0-9]{64}$/;
// This gate trusts the operator's private evaluation record, not uploaded
// caller-asserted native qualification. Re-evaluate the merged composition.
export function releaseGate({review,head,source,evaluation,policy}){
 if(! /^sha256:[a-f0-9]{64}$/.test(policy?.image_id??'')||!hash.test(policy?.harness_hash??'')||evaluation?.profile!=='ace-self-v2')throw Error('Release requires the reviewed v2 evaluator profile');
 if(review?.status!=='merged'||review?.target_branch!=='main'||review.merge?.version!==head||source?.content_hash!==head||nativeHash(source.version)!==head)throw Error('Release requires the current independently merged source');
 const decisions=new Map();
 for(const event of review.events??[])if(event.revision===review.revision&&event.source===review.source&&event.target===review.target&&event.actor!==review.author&&['approve','request_changes'].includes(event.type))decisions.set(event.actor,event.type);
 if(![...decisions.values()].includes('approve')||[...decisions.values()].includes('request_changes'))throw Error('Exact independent approval is missing');
 if(evaluation?.status!=='passed'||evaluation.source_version!==head||evaluation.source_hash!==nativeHash(source.version.files)||evaluation.image_id!==policy?.image_id||evaluation.harness_hash!==policy?.harness_hash||!hash.test(evaluation.source_hash??''))throw Error('Exact merged source was not evaluated by the trusted profile');
 const required=['rust-build','rust-tests','typescript','worker-tests','client-tests','native-contract','schemas'];
 if(!Array.isArray(evaluation.observations)||evaluation.observations.length!==required.length||required.some(id=>evaluation.observations.filter(o=>o.id===id&&o.exit_code===0&&!o.signal&&!o.error).length!==1))throw Error('Release checks are incomplete');
 if(evaluation.infrastructure_error)throw Error('Infrastructure failure cannot qualify a release');
 return {schema_version:1,source_version:head,source_hash:evaluation.source_hash,review_id:review.id,evaluation_hash:nativeHash(evaluation),harness_hash:policy.harness_hash,image_id:policy.image_id,scope:'Independent native review plus trusted operator-run exact-source Linux checks; no hosted qualification'};
}
