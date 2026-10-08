// Resume one failed immutable restore step; never change live source or refs.
export function restoreRetryPlan(id,backup,instance){
 if(!/^backup-(?:[0-9]{8}|[0-9a-f-]{36})$/.test(id)||backup?.id!==id||backup.status!=='completed'||!backup.manifest_hash||backup.restore_status==='completed')throw Error('A sealed incomplete restoration is required');
 if(instance?.params?.id!==id||instance.params.restore!==true||instance.status!=='errored')throw Error('The matching restoration workflow must be errored');
 if(!String(instance.error?.message).includes('Too many API requests by single Worker invocation'))throw Error('This recovery only handles the provider subrequest limit');
 const failed=instance.steps?.find(s=>s.type==='step'&&s.success===false&&/^restore and verify objects [0-9]+-[0-9]+$/.test(s.name));
 if(!failed||!failed.attempts?.some(a=>String(a.error?.message).includes('Too many API requests by single Worker invocation')))throw Error('No failed object-copy step with the expected infrastructure error');
 const match=failed.name.match(/^(restore and verify objects ([0-9]+))-([0-9]+)$/),offset=Number(match[2]);
 if(offset%20!==0||offset>=backup.object_count||backup.object_count>10000)throw Error('Failed object-copy position is outside snapshot bounds');
 return {backup:id,workflow:'restore-'+id,manifest_hash:backup.manifest_hash,objects:backup.object_count,
         from:{name:match[1],count:Number(match[3]),type:'do'},production_source_writes:0,
         scope:'Reuse completed immutable copy steps and resume the failed chunk in a fresh invocation'};
}
