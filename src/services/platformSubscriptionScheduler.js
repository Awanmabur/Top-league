const { platformConnection } = require('../config/db');
const {
  historyEntry,
  subscriptionEffectiveStatus,
  tenantProjectionFromSubscription,
} = require('./platformSubscriptionService');
const { invalidateTenantAccess } = require('./platformTenantAccessCache');
const { invalidatePublicSchoolCache } = require('./platformPublicCacheService');

let timer = null;
let running = false;

function schedulerIntervalMs() {
  const configured = Number(process.env.PLATFORM_SUBSCRIPTION_SCHEDULER_INTERVAL_MS || 300_000);
  if (!Number.isFinite(configured)) return 300_000;
  return Math.min(Math.max(configured, 60_000), 3_600_000);
}

function dueStatusForSubscription(subscription, now = new Date()) {
  if (!subscription || subscription.isDeleted === true || subscription.migrationQuarantined === true) return null;
  if (!['trial', 'active'].includes(String(subscription.status || '').toLowerCase())) return null;
  const effective = subscriptionEffectiveStatus(subscription, now);
  return effective === 'expired' || effective === 'past_due' ? effective : null;
}

async function withTransaction(connection, work) {
  const session = await connection.startSession();
  let result;
  try {
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function processOne({ Tenant, PlatformSubscription, connection }, candidate, now) {
  return withTransaction(connection, async (session) => {
    const current = await PlatformSubscription.findOne({
      _id: candidate._id,
      revision: Number(candidate.revision || 1),
      isDeleted: { $ne: true },
      migrationQuarantined: { $ne: true },
      status: { $in: ['trial', 'active'] },
    }).session(session);
    if (!current) return false;
    const nextStatus = dueStatusForSubscription(current, now);
    if (!nextStatus) return false;

    const nextRevision = Number(current.revision || 1) + 1;
    const reason = nextStatus === 'expired' ? 'Trial period expired.' : 'Paid subscription period expired.';
    const update = await PlatformSubscription.updateOne(
      { _id: current._id, revision: Number(current.revision || 1), isDeleted: { $ne: true } },
      {
        $set: {
          status: nextStatus,
          statusReason: reason,
          expiredAt: nextStatus === 'expired' ? now : current.expiredAt || null,
          suspendedAt: nextStatus === 'past_due' ? (current.suspendedAt || now) : current.suspendedAt || null,
        },
        $inc: { revision: 1 },
        $push: {
          history: historyEntry({
            action: nextStatus === 'expired' ? 'trial_expired' : 'period_past_due',
            fromStatus: current.status,
            toStatus: nextStatus,
            reason,
            planId: current.planId,
            revision: nextRevision,
          }),
        },
      },
      { session },
    );
    if (update.modifiedCount !== 1) return false;

    const projectedSubscription = {
      ...(current.toObject ? current.toObject() : current),
      status: nextStatus,
      revision: nextRevision,
      statusReason: reason,
      expiredAt: nextStatus === 'expired' ? now : current.expiredAt || null,
      suspendedAt: nextStatus === 'past_due' ? (current.suspendedAt || now) : current.suspendedAt || null,
    };
    const projection = tenantProjectionFromSubscription(projectedSubscription);
    const tenant = await Tenant.findOne({ _id: current.tenantId, isDeleted: { $ne: true } }).session(session);
    if (!tenant) throw new Error('Subscription tenant no longer exists.');
    const tenantUpdate = await Tenant.updateOne(
      { _id: tenant._id, revision: Number(tenant.revision || 1), isDeleted: { $ne: true } },
      {
        $set: {
          ...projection,
          status: 'suspended',
          statusReason: reason,
          suspendedAt: tenant.suspendedAt || now,
        },
        $inc: { revision: 1 },
      },
      { session },
    );
    if (tenantUpdate.modifiedCount !== 1) throw new Error('Tenant changed while expiring subscription.');
    return tenant.toObject ? tenant.toObject() : tenant;
  });
}

async function processExpiredPlatformSubscriptions({ connection = platformConnection, models = null, now = new Date(), limit = 100 } = {}) {
  const PlatformSubscription = models?.PlatformSubscription
    || connection.models.PlatformSubscription
    || require('../models/platform/PlatformSubscription')(connection);
  const Tenant = models?.Tenant || connection.models.Tenant || require('../models/platform/Tenant')(connection);
  const current = new Date(now);
  const candidates = await PlatformSubscription.find({
    isDeleted: { $ne: true },
    migrationQuarantined: { $ne: true },
    $or: [
      { status: 'trial', trialEndsAt: { $lte: current } },
      { status: 'active', currentPeriodEnd: { $lte: current } },
    ],
  }).sort({ updatedAt: 1 }).limit(Math.min(Math.max(Number(limit) || 100, 1), 500)).lean();

  let processed = 0;
  for (const candidate of candidates) {
    try {
      const changedTenant = await processOne({ Tenant, PlatformSubscription, connection }, candidate, current);
      if (changedTenant) {
        processed += 1;
        await invalidateTenantAccess(changedTenant).catch((err) => {
          console.error('tenant access cache invalidation failed:', err?.message || err);
        });
        await invalidatePublicSchoolCache();
      }
    } catch (err) {
      console.error(`PLATFORM SUBSCRIPTION SCHEDULER subscription=${candidate._id}:`, err?.message || err);
    }
  }
  return processed;
}

async function scheduledSweep() {
  if (running || process.env.DISABLE_PLATFORM_SUBSCRIPTION_SCHEDULER === 'true') return 0;
  running = true;
  try {
    return await processExpiredPlatformSubscriptions();
  } catch (err) {
    console.error('PLATFORM SUBSCRIPTION SCHEDULER ERROR:', err?.message || err);
    return 0;
  } finally {
    running = false;
  }
}

function startPlatformSubscriptionScheduler() {
  if (timer || process.env.DISABLE_PLATFORM_SUBSCRIPTION_SCHEDULER === 'true') return timer;
  timer = setInterval(() => { scheduledSweep().catch(() => {}); }, schedulerIntervalMs());
  timer.unref?.();
  scheduledSweep().catch(() => {});
  return timer;
}

function stopPlatformSubscriptionScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  schedulerIntervalMs,
  dueStatusForSubscription,
  processExpiredPlatformSubscriptions,
  startPlatformSubscriptionScheduler,
  stopPlatformSubscriptionScheduler,
};
