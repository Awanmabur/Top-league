const { platformConnection, getTenantConnection } = require('../../config/db');
const loadTenantModels = require('../../models/tenant/loadModels');
const { processLeaveStatuses } = require('./leaveService');

const { initialDelayMs } = require('../schedulerTiming');
let timer = null;
let startTimer = null;
let running = false;

function schedulerIntervalMs() {
  const configured = Number(process.env.LEAVE_SCHEDULER_INTERVAL_MS || 300_000);
  if (!Number.isFinite(configured)) return 300_000;
  return Math.min(Math.max(configured, 60_000), 3_600_000);
}

async function processScheduledLeaveStatuses() {
  if (running || process.env.DISABLE_LEAVE_SCHEDULER === 'true') return 0;
  running = true;
  let total = 0;
  try {
    const Tenant = platformConnection.models.Tenant || require('../../models/platform/Tenant')(platformConnection);
    const tenants = await Tenant.find({ isDeleted: { $ne: true }, status: { $in: ['trial', 'active'] }, dbName: { $nin: [null, ''] } })
      .select('_id name code dbName timezone').lean();
    for (const tenant of tenants) {
      try {
        const conn = await getTenantConnection(tenant.dbName);
        const models = loadTenantModels(conn);
        total += await processLeaveStatuses({ models, tenant }, new Date());
      } catch (err) {
        console.error(`LEAVE SCHEDULER tenant=${tenant.code || tenant._id}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('LEAVE SCHEDULER ERROR:', err?.message || err);
  } finally { running = false; }
  return total;
}

function startLeaveScheduler() {
  if (timer || startTimer || process.env.DISABLE_LEAVE_SCHEDULER === 'true') return timer || startTimer;
  const interval = schedulerIntervalMs();
  const run = () => { processScheduledLeaveStatuses().catch(() => {}); };
  const delay = initialDelayMs('LEAVE_SCHEDULER_INITIAL_DELAY_MS', 23000, interval);
  startTimer = setTimeout(() => { startTimer = null; run(); timer = setInterval(run, interval); timer.unref?.(); }, delay);
  startTimer.unref?.();
  return startTimer;
}
function stopLeaveScheduler() { if (startTimer) clearTimeout(startTimer); if (timer) clearInterval(timer); startTimer = null; timer = null; }

module.exports = { schedulerIntervalMs, processScheduledLeaveStatuses, startLeaveScheduler, stopLeaveScheduler };
