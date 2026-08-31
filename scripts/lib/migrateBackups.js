async function migrateBackups(models){
 const M=models?.BackupJob;
 if(!M?.collection)return{scanned:0,normalized:0,quarantined:0};
 const rows=await M.collection.find({}).toArray();
 let normalized=0,quarantined=0;
 for(const r of rows){
  const accessType=r.filePublicId?'authenticated':r.filePath?'legacy':'missing';
  const set={revision:Math.max(1,Number(r.revision||1)),storage:'Cloudinary',accessType,artifactVersion:Number(r.artifactVersion||1)};
  if(r.status==='Running'){
   set.status='Failed';set.failedAt=new Date();set.failureReason='Interrupted legacy backup run requires a new execution.';
  }
  if(r.status==='Completed'&&(!r.checksum||!r.filePublicId||accessType!=='authenticated')){
   set.status='Failed';
   set.failedAt=new Date();
   set.failureReason=!r.checksum?'Legacy completed backup cannot be integrity verified.':'Legacy backup URL is not an authenticated storage authority; create a new backup.';
   set.migrationQuarantinedAt=new Date();
   set.migrationQuarantineReason=!r.checksum?'Missing checksum or authenticated backup artifact.':'Legacy public/redirectable backup URL is intentionally non-restorable.';
   quarantined++;
  }
  if(r.scope==='Media Only'||r.scope==='Database Only')set.scope='Full System';
  await M.collection.updateOne({_id:r._id},{$set:set});
  normalized++;
 }
 return{scanned:rows.length,normalized,quarantined};
}
module.exports={migrateBackups};
