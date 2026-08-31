const {
  normalizeFeatureFlags,
  paymentReferenceKey,
  periodEndForInterval,
  snapshotPlan,
  subscriptionEffectiveStatus,
  tenantProjectionFromSubscription,
} = require('../../src/services/platformSubscriptionService');

const PLAN_MODELS = new Set(['school_only', 'student_only', 'mixed_split']);
const INTERVALS = new Set(['monthly', 'termly', 'semester', 'yearly', 'custom']);
const PAYMENT_TYPES = new Set(['school_subscription', 'student_subscription', 'revenue_split', 'manual_adjust', 'refund', 'credit']);
const PAYMENT_PROVIDERS = new Set(['manual', 'stripe', 'flutterwave', 'pesapal', 'mtn', 'airtel', 'bank', 'other']);
const PAYMENT_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'reconciliation_required']);

function str(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function lower(value) { return str(value).toLowerCase(); }
function upper(value) { return str(value).toUpperCase(); }
function id(value) { return String(value?._id || value || ''); }
function revision(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
function date(value) {
  if (!value) return null;
  const d = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function nonNegative(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function integer(value, fallback = 0, min = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
}
function sameDate(a, b) {
  const da = date(a); const db = date(b);
  if (!da && !db) return true;
  if (!da || !db) return false;
  return da.getTime() === db.getTime();
}
function sameId(a, b) { return id(a) === id(b); }

async function readAll(Model, filter = {}) {
  if (!Model) return [];
  const q = Model.find(filter);
  if (q && typeof q.lean === 'function') return q.lean();
  return q;
}

function normalizePlanDocument(plan = {}) {
  const billingModel = PLAN_MODELS.has(lower(plan.billingModel)) ? lower(plan.billingModel) : 'school_only';
  const billingInterval = INTERVALS.has(lower(plan.billingInterval)) ? lower(plan.billingInterval) : 'monthly';
  const currency = /^[A-Z]{3,10}$/.test(upper(plan.currency)) ? upper(plan.currency) : 'USD';
  const code = lower(plan.code || plan.name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `legacy-${id(plan).slice(-12)}`;
  const name = str(plan.name, 120) || `Legacy Plan ${id(plan).slice(-8)}`;
  return {
    name,
    code,
    billingModel,
    billingInterval,
    currency,
    pricePerSchool: nonNegative(plan.pricePerSchool),
    pricePerStudent: nonNegative(plan.pricePerStudent),
    platformSharePercent: Math.min(100, nonNegative(plan.platformSharePercent)),
    trialDays: Math.min(3650, integer(plan.trialDays, 0)),
    maxStudents: Math.min(10000000, integer(plan.maxStudents, 0)),
    maxStaff: Math.min(1000000, integer(plan.maxStaff, 0)),
    maxCampuses: Math.min(10000, integer(plan.maxCampuses, 1, 1)),
    enabledModules: [...new Set((Array.isArray(plan.enabledModules) ? plan.enabledModules : []).map((v) => str(v, 100)).filter(Boolean))].slice(0, 250),
    featureFlags: normalizeFeatureFlags(plan.featureFlags || {}),
    revision: revision(plan.revision),
  };
}

function planChanged(plan, normalized) {
  const scalar = ['name', 'code', 'billingModel', 'billingInterval', 'currency', 'pricePerSchool', 'pricePerStudent', 'platformSharePercent', 'trialDays', 'maxStudents', 'maxStaff', 'maxCampuses', 'revision'];
  if (scalar.some((key) => String(plan?.[key] ?? '') !== String(normalized[key] ?? ''))) return true;
  if (JSON.stringify(plan?.enabledModules || []) !== JSON.stringify(normalized.enabledModules)) return true;
  if (JSON.stringify(normalizeFeatureFlags(plan?.featureFlags || {})) !== JSON.stringify(normalized.featureFlags)) return true;
  return false;
}

async function migratePlans(Plan) {
  const rows = await readAll(Plan);
  let normalized = 0;
  for (const row of rows) {
    const patch = normalizePlanDocument(row);
    if (planChanged(row, patch)) {
      await Plan.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized };
}

async function ensureQuarantinePlan(Plan) {
  let existing = await Plan.findOne({ code: 'legacy-quarantine' });
  if (existing?.lean) existing = await existing.lean();
  if (existing) return existing;
  const payload = {
    name: 'Legacy Quarantine', code: 'legacy-quarantine', description: 'Migration-only fail-closed plan for unresolved legacy tenant subscriptions.',
    billingModel: 'school_only', pricePerSchool: 0, pricePerStudent: 0, platformSharePercent: 0, currency: 'USD', billingInterval: 'custom', trialDays: 0,
    maxStudents: 0, maxStaff: 0, maxCampuses: 1, enabledModules: [], featureFlags: normalizeFeatureFlags({}), sortOrder: 999999, isPublic: false, isActive: false, isDeleted: false, revision: 1,
  };
  const created = await Plan.create(payload);
  return created?.toObject ? created.toObject() : created;
}

function subscriptionRank(row) {
  if (row.isDeleted === true) return -100;
  let score = row.migrationQuarantined === true ? 0 : 100;
  const status = subscriptionEffectiveStatus(row);
  if (status === 'active') score += 50;
  else if (status === 'trial') score += 40;
  else if (status === 'past_due' || status === 'suspended') score += 20;
  else if (status === 'expired') score += 10;
  return score;
}

async function dedupeSubscriptions(PlatformSubscription, now = new Date()) {
  const rows = await readAll(PlatformSubscription);
  const groups = new Map();
  for (const row of rows) {
    if (row.isDeleted === true || !id(row.tenantId)) continue;
    const key = id(row.tenantId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let duplicatesQuarantined = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => subscriptionRank(b) - subscriptionRank(a)
      || (date(b.updatedAt)?.getTime() || date(b.createdAt)?.getTime() || 0) - (date(a.updatedAt)?.getTime() || date(a.createdAt)?.getTime() || 0)
      || id(a).localeCompare(id(b)));
    for (const row of list.slice(1)) {
      await PlatformSubscription.updateOne({ _id: row._id }, {
        $set: {
          isDeleted: true,
          deletedAt: row.deletedAt || now,
          migrationQuarantined: true,
          quarantineReason: 'Migration: duplicate current subscription for tenant; preserved as deleted audit history.',
          status: row.status === 'cancelled' ? 'cancelled' : 'suspended',
        },
      });
      duplicatesQuarantined += 1;
    }
  }
  return { scanned: rows.length, duplicatesQuarantined };
}

function buildLegacySubscription({ tenant, plan, quarantineReason = '', now = new Date() }) {
  const planSnapshot = snapshotPlan(normalizePlanDocument(plan));
  const legacyStatus = lower(tenant.status);
  const startsAt = date(tenant.subscriptionStartsAt) || date(tenant.createdAt) || new Date(now);
  let status = ['trial', 'active', 'suspended', 'cancelled'].includes(legacyStatus) ? legacyStatus : 'suspended';
  let trialEndsAt = date(tenant.trialEndsAt);
  let currentPeriodStart = date(tenant.subscriptionStartsAt) || date(tenant.lastBilledAt) || startsAt;
  let currentPeriodEnd = date(tenant.subscriptionEndsAt);
  let migrationQuarantined = Boolean(quarantineReason);
  let reason = str(quarantineReason, 500);

  if (status === 'trial') {
    if (!trialEndsAt) trialEndsAt = new Date(startsAt.getTime() + Number(planSnapshot.trialDays || 0) * 86400000);
    if (!trialEndsAt || trialEndsAt <= now) {
      status = 'expired';
      reason = reason || 'Migration: legacy trial has expired.';
    }
    currentPeriodStart = null;
    currentPeriodEnd = null;
  } else if (status === 'active') {
    trialEndsAt = null;
    if (!currentPeriodEnd && planSnapshot.billingInterval !== 'custom') {
      currentPeriodEnd = periodEndForInterval(currentPeriodStart, planSnapshot.billingInterval);
    }
    if (planSnapshot.billingInterval === 'custom' && !currentPeriodEnd) {
      status = 'suspended';
      migrationQuarantined = true;
      reason = [reason, 'Migration: active custom-billing subscription had no explicit period end.'].filter(Boolean).join(' ').slice(0, 500);
    } else if (currentPeriodEnd && currentPeriodEnd <= now) {
      status = 'past_due';
      reason = reason || 'Migration: legacy paid period has expired.';
    }
  } else if (status === 'cancelled') {
    trialEndsAt = null;
  }

  return {
    tenantId: tenant._id,
    planId: plan._id,
    planSnapshot,
    status,
    startsAt,
    trialEndsAt,
    currentPeriodStart,
    currentPeriodEnd,
    suspendedAt: status === 'suspended' || status === 'past_due' ? (date(tenant.suspendedAt) || now) : null,
    cancelledAt: status === 'cancelled' ? (date(tenant.cancelledAt) || now) : null,
    expiredAt: status === 'expired' ? now : null,
    statusReason: reason,
    lastBilledAt: date(tenant.lastBilledAt),
    revision: 1,
    history: [{ at: now, action: 'migration_import', fromStatus: legacyStatus, toStatus: status, reason, planId: plan._id, revision: 1 }],
    migrationQuarantined,
    quarantineReason: migrationQuarantined ? (reason || 'Migration: legacy subscription requires review.') : '',
    isDeleted: false,
  };
}

async function migrateSubscriptions({ Tenant, Plan, PlatformSubscription }, now = new Date()) {
  const dedupe = await dedupeSubscriptions(PlatformSubscription, now);
  const [tenants, plans, existingRows] = await Promise.all([
    readAll(Tenant, { isDeleted: { $ne: true } }),
    readAll(Plan, { isDeleted: { $ne: true } }),
    readAll(PlatformSubscription, { isDeleted: { $ne: true } }),
  ]);
  const planById = new Map(plans.map((p) => [id(p), p]));
  const planByName = new Map(plans.map((p) => [lower(p.name), p]));
  const currentByTenant = new Map(existingRows.filter((s) => s.isDeleted !== true).map((s) => [id(s.tenantId), s]));
  let created = 0; let normalized = 0; let tenantsLinked = 0; let quarantined = 0;
  let quarantinePlan = null;

  for (const tenant of tenants) {
    if (lower(tenant.status) === 'deleted') {
      await Tenant.updateOne({ _id: tenant._id }, { $set: { isDeleted: true, archivedAt: tenant.archivedAt || now } });
      continue;
    }
    let subscription = currentByTenant.get(id(tenant));
    let plan = planById.get(id(subscription?.planId || tenant.planId)) || planByName.get(lower(tenant.planName));
    let unresolvedReason = '';
    if (!plan) {
      quarantinePlan = quarantinePlan || await ensureQuarantinePlan(Plan);
      plan = quarantinePlan;
      planById.set(id(plan), plan);
      unresolvedReason = 'Migration: tenant plan could not be resolved; assigned to fail-closed Legacy Quarantine plan.';
    }

    if (!subscription) {
      const payload = buildLegacySubscription({ tenant, plan, quarantineReason: unresolvedReason, now });
      const createdRow = await PlatformSubscription.create(payload);
      subscription = createdRow?.toObject ? createdRow.toObject() : createdRow;
      currentByTenant.set(id(tenant), subscription);
      created += 1;
      if (payload.migrationQuarantined) quarantined += 1;
    } else {
      const patch = {};
      if (revision(subscription.revision) !== subscription.revision) patch.revision = revision(subscription.revision);
      if (!subscription.planSnapshot || !subscription.planSnapshot.name || !subscription.planSnapshot.code) patch.planSnapshot = snapshotPlan(normalizePlanDocument(plan));
      if (!id(subscription.planId) || !sameId(subscription.planId, plan._id)) patch.planId = plan._id;
      if (subscription.migrationQuarantined !== true && unresolvedReason) {
        patch.migrationQuarantined = true;
        patch.quarantineReason = unresolvedReason;
        patch.status = 'suspended';
        patch.suspendedAt = subscription.suspendedAt || now;
        quarantined += 1;
      } else if (subscription.migrationQuarantined === undefined) patch.migrationQuarantined = false;
      if (Object.keys(patch).length) {
        await PlatformSubscription.updateOne({ _id: subscription._id }, { $set: patch });
        subscription = { ...subscription, ...patch };
        currentByTenant.set(id(tenant), subscription);
        normalized += 1;
      }
    }

    const effective = subscriptionEffectiveStatus(subscription, now);
    const effectiveSubscription = { ...subscription, status: effective };
    const projection = tenantProjectionFromSubscription(effectiveSubscription);
    const desiredStatus = projection.status;
    const tenantPatch = {};
    if (!sameId(tenant.subscriptionId, subscription._id)) tenantPatch.subscriptionId = subscription._id;
    if (Number(tenant.subscriptionRevision || 1) !== revision(subscription.revision)) tenantPatch.subscriptionRevision = revision(subscription.revision);
    if (!sameId(tenant.planId, subscription.planId)) tenantPatch.planId = subscription.planId;
    if (str(tenant.planName, 120) !== str(subscription.planSnapshot?.name, 120)) tenantPatch.planName = str(subscription.planSnapshot?.name, 120);
    if (tenant.status !== desiredStatus) tenantPatch.status = desiredStatus;
    if (!sameDate(tenant.trialEndsAt, projection.trialEndsAt)) tenantPatch.trialEndsAt = projection.trialEndsAt;
    if (!sameDate(tenant.subscriptionStartsAt, projection.subscriptionStartsAt)) tenantPatch.subscriptionStartsAt = projection.subscriptionStartsAt;
    if (!sameDate(tenant.subscriptionEndsAt, projection.subscriptionEndsAt)) tenantPatch.subscriptionEndsAt = projection.subscriptionEndsAt;
    if (!sameDate(tenant.lastBilledAt, projection.lastBilledAt)) tenantPatch.lastBilledAt = projection.lastBilledAt;
    if (['suspended', 'past_due', 'expired'].includes(effective) && !tenant.suspendedAt) tenantPatch.suspendedAt = now;
    if (effective === 'cancelled' && !tenant.cancelledAt) tenantPatch.cancelledAt = now;
    if (revision(tenant.revision) !== tenant.revision) tenantPatch.revision = revision(tenant.revision);
    if (Object.keys(tenantPatch).length) {
      await Tenant.updateOne({ _id: tenant._id }, { $set: tenantPatch });
      tenantsLinked += 1;
    }
  }

  return { scanned: tenants.length, created, normalized, tenantsLinked, quarantined, duplicatesQuarantined: dedupe.duplicatesQuarantined };
}

function paymentRank(row) {
  const status = lower(row.status);
  if (status === 'completed') return 50;
  if (status === 'processing') return 40;
  if (status === 'pending') return 30;
  return 10;
}

async function migratePayments({ PlatformPayment, PlatformSubscription }, now = new Date()) {
  const [rows, subscriptions] = await Promise.all([readAll(PlatformPayment), readAll(PlatformSubscription, { isDeleted: { $ne: true } })]);
  const subByTenant = new Map(subscriptions.filter((s) => s.isDeleted !== true).map((s) => [id(s.tenantId), s]));
  const duplicateGroups = new Map();
  for (const row of rows) {
    const key = paymentReferenceKey(row.provider || 'manual', row.reference, row.tenantId);
    if (!key) continue;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(row);
  }
  const keepByKey = new Map();
  for (const [key, list] of duplicateGroups) {
    list.sort((a, b) => paymentRank(b) - paymentRank(a)
      || (date(a.paidAt)?.getTime() || date(a.createdAt)?.getTime() || 0) - (date(b.paidAt)?.getTime() || date(b.createdAt)?.getTime() || 0)
      || id(a).localeCompare(id(b)));
    keepByKey.set(key, id(list[0]));
  }

  let normalized = 0; let quarantined = 0; let duplicateReferences = 0; let subscriptionsLinked = 0;
  for (const row of rows) {
    const patch = {};
    const reasons = [];
    const provider = PAYMENT_PROVIDERS.has(lower(row.provider)) ? lower(row.provider) : 'other';
    const type = PAYMENT_TYPES.has(lower(row.type)) ? lower(row.type) : 'manual_adjust';
    const status = PAYMENT_STATUSES.has(lower(row.status)) ? lower(row.status) : 'reconciliation_required';
    const key = paymentReferenceKey(provider, row.reference, row.tenantId);
    const sub = subByTenant.get(id(row.tenantId));

    if (provider !== row.provider) patch.provider = provider;
    if (type !== row.type) { patch.type = type; reasons.push('Legacy payment type was invalid.'); }
    if (status !== row.status) { patch.status = status; reasons.push('Legacy payment status was invalid.'); }
    if (revision(row.revision) !== row.revision) patch.revision = revision(row.revision);
    if (!Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0) reasons.push('Legacy payment amount is non-positive or invalid.');
    const currency = /^[A-Z]{3,10}$/.test(upper(row.currency)) ? upper(row.currency) : upper(sub?.planSnapshot?.currency || 'USD');
    if (currency !== row.currency) patch.currency = currency;
    if (['school_subscription', 'student_subscription'].includes(type)) {
      if (!sub) reasons.push('No current subscription could be resolved for subscription payment.');
      else {
        if (!sameId(row.subscriptionId, sub._id)) { patch.subscriptionId = sub._id; subscriptionsLinked += 1; }
        if (!sameId(row.planId, sub.planId)) patch.planId = sub.planId;
        if (Number(row.subscriptionRevision || 0) < 1) patch.subscriptionRevision = revision(sub.revision);
        if (upper(sub.planSnapshot?.currency) && currency !== upper(sub.planSnapshot.currency)) reasons.push('Subscription payment currency does not match frozen plan currency.');
      }
    } else if (sub && !row.subscriptionId) {
      patch.subscriptionId = sub._id;
      patch.subscriptionRevision = revision(sub.revision);
    }
    if (status === 'completed' && !str(row.reference)) reasons.push('Completed legacy payment has no reference.');

    if (key && keepByKey.get(key) !== id(row)) {
      patch.referenceKey = null;
      reasons.push('Duplicate provider/reference; preserved for manual reconciliation.');
      duplicateReferences += 1;
    } else if ((row.referenceKey || null) !== (key || null)) patch.referenceKey = key || null;

    if (reasons.length) {
      patch.migrationQuarantined = true;
      patch.quarantineReason = reasons.join(' ').slice(0, 500);
      if (!['failed', 'cancelled', 'refunded'].includes(status)) patch.status = 'reconciliation_required';
      quarantined += row.migrationQuarantined === true ? 0 : 1;
    } else if (row.migrationQuarantined !== false || row.quarantineReason) {
      // Valid rows are explicitly included in the partial unique index. Do not auto-clear a manually quarantined row.
      if (row.migrationQuarantined !== true) {
        patch.migrationQuarantined = false;
        patch.quarantineReason = '';
      }
    }

    if (Object.keys(patch).length) {
      await PlatformPayment.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized, quarantined, duplicateReferences, subscriptionsLinked };
}

async function migratePlatformSaas(models = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const required = ['Tenant', 'Plan', 'PlatformSubscription', 'PlatformPayment'];
  for (const name of required) if (!models[name]) throw new Error(`migratePlatformSaas requires ${name}`);
  const plans = await migratePlans(models.Plan);
  const subscriptions = await migrateSubscriptions(models, now);
  const payments = await migratePayments(models, now);
  return { plans, subscriptions, payments };
}

module.exports = {
  migratePlatformSaas,
  migratePlans,
  migrateSubscriptions,
  migratePayments,
  normalizePlanDocument,
  buildLegacySubscription,
};
