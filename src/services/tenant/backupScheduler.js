const { platformConnection, getTenantConnection }=require('../../config/db');
const loadTenantModels=require('../../models/tenant/loadModels');
const { executeJob }=require('../../controllers/tenant/admin/backupController');
let timer=null,running=false;
function schedulerIntervalMs(){const n=Number(process.env.BACKUP_SCHEDULER_INTERVAL_MS||60000);return Number.isFinite(n)?Math.min(Math.max(n,30000),3600000):60000;}
async function processScheduledBackups(now=new Date()){
 if(running||process.env.DISABLE_BACKUP_SCHEDULER==='true')return 0;running=true;let total=0;
 try{const Tenant=platformConnection.models.Tenant||require('../../models/platform/Tenant')(platformConnection);const tenants=await Tenant.find({isDeleted:{$ne:true},status:{$in:['trial','active']},dbName:{$nin:[null,'']}}).select('_id name code dbName timezone').lean();for(const tenant of tenants){try{const conn=await getTenantConnection(tenant.dbName),models=loadTenantModels(conn),jobs=await models.BackupJob.find({status:'Scheduled',isDeleted:{$ne:true},migrationQuarantinedAt:null,$or:[{scheduleAt:null},{scheduleAt:{$lte:now}}]}).sort({scheduleAt:1,createdAt:1}).limit(3).lean();for(const job of jobs){try{await executeJob({models,tenant,user:null,session:{}},job);total++;}catch(err){console.error(`BACKUP SCHEDULER job=${job._id}:`,err?.message||err);}}}catch(err){console.error(`BACKUP SCHEDULER tenant=${tenant.code||tenant._id}:`,err?.message||err);}}}catch(err){console.error('BACKUP SCHEDULER ERROR:',err?.message||err);}finally{running=false;}return total;
}
function startBackupScheduler(){if(timer||process.env.DISABLE_BACKUP_SCHEDULER==='true')return timer;timer=setInterval(()=>processScheduledBackups().catch(()=>{}),schedulerIntervalMs());timer.unref?.();return timer;}
function stopBackupScheduler(){if(timer)clearInterval(timer);timer=null;}
module.exports={schedulerIntervalMs,processScheduledBackups,startBackupScheduler,stopBackupScheduler};
