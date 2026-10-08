const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const same=(a,b)=>JSON.stringify([...a].sort((x,y)=>x.version_id.localeCompare(y.version_id)))===JSON.stringify([...b].sort((x,y)=>x.version_id.localeCompare(y.version_id)));
export async function rollout({before,candidate,read,deploy,smoke,record=async()=>{},drill=false}){
 if(!uuid.test(before)||!uuid.test(candidate)||before===candidate)throw Error('Choose distinct uploaded Worker versions');
 let current=await read();if(!same(current.versions,[{version_id:before,percentage:100}]))throw Error('Current deployment differs from the expected stable version');
 const evidence={schema_version:1,before,candidate,stages:[],rollback_drill:false,scope:'Worker traffic and read-only smoke checks; no database, container-image or production-data restoration'};
 const move=async versions=>{
  const latest=await read();if(latest.id!==current.id)throw Error('Concurrent deployment detected; refusing to overwrite it');
  const saved=await deploy(versions);current=saved;
  const observed=await read();if(observed.id!==saved.id||!same(observed.versions,versions))throw Error('Deployment changed before verification');
  current=observed;
 };
 try{
  await smoke(before);
  for(const percent of [10,50,100]){
   const versions=percent===100?[{version_id:candidate,percentage:100}]:[{version_id:before,percentage:100-percent},{version_id:candidate,percentage:percent}];
   await move(versions);const checks=await smoke(candidate);evidence.stages.push({percent,deployment:current.id,checks});await record(evidence);
   if(drill&&percent===50){await move([{version_id:before,percentage:100}]);const checks=await smoke(before);evidence.rollback_drill={deployment:current.id,checks};await record(evidence);}
  }
  evidence.status='completed';await record(evidence);return evidence;
 }catch(error){
  evidence.status='failed';
  await record(evidence);
  // Provider writes are not an atomic CAS. Preserve a competing deployment.
  try{const latest=await read();if(latest.id===current.id){await move([{version_id:before,percentage:100}]);evidence.recovered=await smoke(before);evidence.rollback_deployment=current.id;}else evidence.rollback_blocked='Concurrent deployment; operator reconciliation required';}
  catch{evidence.rollback_blocked='Provider or recovery checks failed; operator reconciliation required';}
  await record(evidence);throw error;
 }
}
