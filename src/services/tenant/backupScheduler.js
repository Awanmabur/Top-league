const { platformConnection, getTenantConnection } = require('../../config/db');
const loadTenantModels = require('../../models/tenant/loadModels');
const { executeJob } = require('../../controllers/tenant/admin/backupController');
const { initialDelayMs } = require('../schedulerTiming');

let timer = null;
let startTimer = null;
let running = false;

function schedulerIntervalMs() {
  const n = Number(process.env.BACKUP_SCHEDULER_INTERVAL_MS || 300_000);
  return Number.isFinite(n) ? Math.min(Math.max(n, 60_000), 3_600_000) : 300_000;
}
function maxJobsPerSweep() {
  const n = Number(process.env.BACKUP_SCHEDULER_MAX_JOBS_PER_SWEEP || 2);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 10) : 2;
}

async function processScheduledBackups(now = new Date()) {
  if (running || process.env.DISABLE_BACKUP_SCHEDULER === 'true') return 0;
  running = true;
  let total = 0;
  const maxJobs = maxJobsPerSweep();
  try {
    const Tenant = platformConnection.models.Tenant || require('../../models/platform/Tenant')(platformConnection);
    const tenants = await Tenant.find({
      isDeleted: { $ne: true },
      status: { $in: ['trial', 'active'] },
      dbName: { $nin: [null, ''] },
    }).select('_id name code dbName timezone').lean();

    for (const tenant of tenants) {
      if (total >= maxJobs) break;
      try {
        const conn = await getTenantConnection(tenant.dbName);
        const models = loadTenantModels(conn);
        const jobs = await models.BackupJob.find({
          status: 'Scheduled',
          isDeleted: { $ne: true },
          migrationQuarantinedAt: null,
          $or: [{ scheduleAt: null }, { scheduleAt: { $lte: now } }],
        }).sort({ scheduleAt: 1, createdAt: 1 }).limit(1).lean();
        for (const job of jobs) {
          try {
            await executeJob({ models, tenant, user: null, session: {} }, job);
            total++;
          } catch (err) {
            console.error(`BACKUP SCHEDULER job=${job._id}:`, err?.message || err);
          }
        }
      } catch (err) {
        console.error(`BACKUP SCHEDULER tenant=${tenant.code || tenant._id}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('BACKUP SCHEDULER ERROR:', err?.message || err);
  } finally {
    running = false;
  }
  return total;
}

function startBackupScheduler() {
  if (timer || startTimer || process.env.DISABLE_BACKUP_SCHEDULER === 'true') return timer || startTimer;
  const interval = schedulerIntervalMs();
  const run = () => processScheduledBackups().catch(() => {});
  const delay = initialDelayMs('BACKUP_SCHEDULER_INITIAL_DELAY_MS', 29_000, interval);
  startTimer = setTimeout(() => {
    startTimer = null;
    run();
    timer = setInterval(run, interval);
    timer.unref?.();
  }, delay);
  startTimer.unref?.();
  return startTimer;
}

function stopBackupScheduler() {
  if (startTimer) clearTimeout(startTimer);
  if (timer) clearInterval(timer);
  startTimer = null;
  timer = null;
}
module.exports = { schedulerIntervalMs, maxJobsPerSweep, processScheduledBackups, startBackupScheduler, stopBackupScheduler };
