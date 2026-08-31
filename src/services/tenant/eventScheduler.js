const { platformConnection, getTenantConnection } = require("../../config/db");
const loadTenantModels = require("../../models/tenant/loadModels");
const { processDueEvents } = require("./eventService");

let timer = null;
let running = false;

function schedulerIntervalMs() {
  const configured = Number(process.env.EVENT_SCHEDULER_INTERVAL_MS || 60_000);
  if (!Number.isFinite(configured)) return 60_000;
  return Math.min(Math.max(configured, 15_000), 3_600_000);
}

async function processScheduledEvents() {
  if (running || process.env.DISABLE_EVENT_SCHEDULER === "true") return 0;
  running = true;
  let total = 0;
  try {
    const Tenant = platformConnection.models.Tenant || require("../../models/platform/Tenant")(platformConnection);
    const tenants = await Tenant.find({
      isDeleted: { $ne: true },
      status: { $in: ["trial", "active"] },
      dbName: { $nin: [null, ""] },
    })
      .select("_id name code dbName timezone")
      .lean();

    for (const tenant of tenants) {
      try {
        const conn = await getTenantConnection(tenant.dbName);
        const models = loadTenantModels(conn);
        total += await processDueEvents({ models, tenant, user: null }, new Date());
      } catch (err) {
        console.error(`EVENT SCHEDULER tenant=${tenant.code || tenant._id}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error("EVENT SCHEDULER ERROR:", err?.message || err);
  } finally {
    running = false;
  }
  return total;
}

function startEventScheduler() {
  if (timer || process.env.DISABLE_EVENT_SCHEDULER === "true") return timer;
  const interval = schedulerIntervalMs();
  timer = setInterval(() => {
    processScheduledEvents().catch(() => {});
  }, interval);
  timer.unref?.();
  return timer;
}

function stopEventScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  schedulerIntervalMs,
  processScheduledEvents,
  startEventScheduler,
  stopEventScheduler,
};
