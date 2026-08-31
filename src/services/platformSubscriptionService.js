const crypto = require("crypto");

const OPERATIONAL_STATUSES = new Set(["trial", "active"]);
const SUBSCRIPTION_STATUSES = new Set([
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
  "expired",
]);
const TENANT_STATUSES = new Set(["trial", "active", "suspended", "cancelled", "deleted"]);
const PAYMENT_TYPES = new Set([
  "school_subscription",
  "student_subscription",
  "revenue_split",
  "manual_adjust",
  "refund",
  "credit",
]);
const PAYMENT_PROVIDERS = new Set(["manual", "stripe", "flutterwave", "pesapal", "mtn", "airtel", "bank", "other"]);
const PAYMENT_CREATE_STATUSES = new Set(["pending", "completed"]);
const BILLING_INTERVALS = new Set(["monthly", "termly", "semester", "yearly", "custom"]);
const BILLING_MODELS = new Set(["school_only", "student_only", "mixed_split"]);

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function positiveRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("A current positive revision is required.");
  return revision;
}

function bool(value) {
  if (value === true || value === 1) return true;
  return ["1", "true", "yes", "on"].includes(lower(value));
}

function normalizeFeatureFlags(flags = {}) {
  return {
    customDomain: flags.customDomain === true || bool(flags.customDomain),
    apiAccess: flags.apiAccess === true || bool(flags.apiAccess),
    prioritySupport: flags.prioritySupport === true || bool(flags.prioritySupport),
    whiteLabel: flags.whiteLabel === true || bool(flags.whiteLabel),
    advancedReports: flags.advancedReports === true || bool(flags.advancedReports),
    helpdesk: flags.helpdesk === true || bool(flags.helpdesk),
    backups: flags.backups === undefined ? true : flags.backups === true || bool(flags.backups),
    systemHealth: flags.systemHealth === undefined ? true : flags.systemHealth === true || bool(flags.systemHealth),
  };
}

function normalizeModules(value) {
  const list = Array.isArray(value) ? value : clean(value) ? clean(value).split(",") : [];
  return [...new Set(list.map(clean).filter(Boolean))].slice(0, 250);
}

function validatePlanInput(input = {}) {
  const billingModel = lower(input.billingModel);
  const billingInterval = lower(input.billingInterval || "monthly");
  const currency = upper(input.currency || "USD");
  const pricePerSchool = finiteNumber(input.pricePerSchool, NaN);
  const pricePerStudent = finiteNumber(input.pricePerStudent, NaN);
  const platformSharePercent = finiteNumber(input.platformSharePercent, NaN);
  const trialDays = integer(Number(input.trialDays), NaN);
  const maxStudents = integer(Number(input.maxStudents), NaN);
  const maxStaff = integer(Number(input.maxStaff), NaN);
  const maxCampuses = integer(Number(input.maxCampuses), NaN);

  if (!BILLING_MODELS.has(billingModel)) throw new Error("Invalid billing model.");
  if (!BILLING_INTERVALS.has(billingInterval)) throw new Error("Invalid billing interval.");
  if (!/^[A-Z]{3,10}$/.test(currency)) throw new Error("Currency must be a 3–10 letter code.");
  for (const [label, value] of [
    ["School price", pricePerSchool],
    ["Student price", pricePerStudent],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1e12) throw new Error(`${label} is invalid.`);
  }
  if (!Number.isFinite(platformSharePercent) || platformSharePercent < 0 || platformSharePercent > 100) {
    throw new Error("Platform share percent must be between 0 and 100.");
  }
  for (const [label, value, max] of [
    ["Trial days", trialDays, 3650],
    ["Student limit", maxStudents, 10000000],
    ["Staff limit", maxStaff, 1000000],
    ["Campus limit", maxCampuses, 10000],
  ]) {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label} is invalid.`);
  }
  if (maxCampuses === 0) throw new Error("Campus limit must be at least 1; use a large value for effectively unlimited campuses.");

  return {
    billingModel,
    billingInterval,
    pricePerSchool,
    pricePerStudent,
    platformSharePercent,
    currency,
    trialDays,
    maxStudents,
    maxStaff,
    maxCampuses,
    enabledModules: normalizeModules(input.enabledModules),
    featureFlags: normalizeFeatureFlags(input.featureFlags || input),
  };
}

function snapshotPlan(plan) {
  if (!plan) throw new Error("Plan is required for a subscription snapshot.");
  const validated = validatePlanInput(plan);
  const name = clean(plan.name);
  const code = lower(plan.code);
  if (!name || !code) throw new Error("Plan name and code are required.");
  return {
    planRevision: Number.isInteger(Number(plan.revision)) && Number(plan.revision) > 0 ? Number(plan.revision) : 1,
    name,
    code,
    ...validated,
  };
}

function addMonthsUtc(date, months) {
  const source = new Date(date);
  const day = source.getUTCDate();
  const next = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds()));
  const maxDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, maxDay));
  return next;
}

function periodEndForInterval(start, interval) {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) throw new Error("A valid billing period start is required.");
  switch (lower(interval)) {
    case "monthly": return addMonthsUtc(from, 1);
    case "termly": return addMonthsUtc(from, 4);
    case "semester": return addMonthsUtc(from, 6);
    case "yearly": return addMonthsUtc(from, 12);
    case "custom": return null;
    default: throw new Error("Unsupported billing interval.");
  }
}

function normalizeDate(value, label, { optional = true } = {}) {
  if (value == null || clean(value) === "") {
    if (optional) return null;
    throw new Error(`${label} is required.`);
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date;
}

function buildInitialSubscription({ tenantId, plan, requestedStatus = "trial", trialEndsAt = null, statusReason = "", actorId = null, now = new Date() }) {
  const snapshot = snapshotPlan(plan);
  const status = lower(requestedStatus || "trial");
  if (!["trial", "active"].includes(status)) throw new Error("New tenants may start only in trial or active status.");
  const started = new Date(now);
  let trialEnd = null;
  let currentPeriodStart = null;
  let currentPeriodEnd = null;

  if (status === "trial") {
    trialEnd = normalizeDate(trialEndsAt, "Trial end date") || new Date(started.getTime() + snapshot.trialDays * 86400000);
    if (trialEnd <= started) throw new Error("Trial end date must be in the future.");
  } else {
    currentPeriodStart = started;
    if (snapshot.billingInterval === "custom") {
      throw new Error("Custom-billing plans must be activated by a completed payment with an explicit period end.");
    }
    currentPeriodEnd = periodEndForInterval(started, snapshot.billingInterval);
  }

  return {
    tenantId,
    planId: plan._id,
    planSnapshot: snapshot,
    status,
    startsAt: started,
    trialEndsAt: trialEnd,
    currentPeriodStart,
    currentPeriodEnd,
    statusReason: clean(statusReason).slice(0, 500),
    revision: 1,
    history: [{
      at: started,
      action: status === "active" ? "created_active_override" : "created",
      fromStatus: "",
      toStatus: status,
      reason: clean(statusReason).slice(0, 500),
      actorId: actorId || undefined,
      planId: plan._id,
      revision: 1,
    }],
    createdBy: actorId || undefined,
    updatedBy: actorId || undefined,
    isDeleted: false,
  };
}

function subscriptionEffectiveStatus(subscription, now = new Date()) {
  const status = lower(subscription?.status);
  if (!SUBSCRIPTION_STATUSES.has(status)) return "suspended";
  const current = new Date(now);
  if (status === "trial") {
    const trialEnd = normalizeDate(subscription?.trialEndsAt, "Trial end date");
    if (trialEnd && trialEnd <= current) return "expired";
  }
  if (status === "active") {
    const end = normalizeDate(subscription?.currentPeriodEnd, "Current period end");
    if (end && end <= current) return "past_due";
  }
  return status;
}

function isSubscriptionOperational(subscription, now = new Date()) {
  return OPERATIONAL_STATUSES.has(subscriptionEffectiveStatus(subscription, now));
}

function tenantProjectionFromSubscription(subscription) {
  const effective = subscriptionEffectiveStatus(subscription);
  const tenantStatus = effective === "past_due" || effective === "expired" ? "suspended" : effective;
  return {
    planId: subscription.planId,
    planName: subscription.planSnapshot?.name || "",
    subscriptionId: subscription._id,
    subscriptionRevision: Number(subscription.revision || 1),
    status: TENANT_STATUSES.has(tenantStatus) ? tenantStatus : "suspended",
    trialEndsAt: subscription.trialEndsAt || null,
    subscriptionStartsAt: subscription.currentPeriodStart || subscription.startsAt || null,
    subscriptionEndsAt: subscription.currentPeriodEnd || null,
    lastBilledAt: subscription.lastBilledAt || null,
  };
}

const TRANSITIONS = {
  trial: new Set(["active", "suspended", "cancelled", "expired"]),
  active: new Set(["past_due", "suspended", "cancelled"]),
  past_due: new Set(["active", "suspended", "cancelled"]),
  suspended: new Set(["active", "cancelled"]),
  cancelled: new Set([]),
  expired: new Set(["active", "cancelled"]),
};

function assertSubscriptionTransition(fromStatus, toStatus) {
  const from = lower(fromStatus);
  const to = lower(toStatus);
  if (!SUBSCRIPTION_STATUSES.has(from) || !SUBSCRIPTION_STATUSES.has(to)) throw new Error("Invalid subscription status.");
  if (from === to) return true;
  if (!TRANSITIONS[from]?.has(to)) throw new Error(`Subscription cannot move from ${from} to ${to}.`);
  return true;
}

function mapTenantStatusToSubscription(status) {
  const cleanStatus = lower(status);
  if (cleanStatus === "trial" || cleanStatus === "active" || cleanStatus === "suspended" || cleanStatus === "cancelled") return cleanStatus;
  throw new Error("Invalid tenant lifecycle status.");
}

function assertCampusLimit(planLike, campusesCount) {
  const limit = Number(planLike?.maxCampuses ?? planLike?.planSnapshot?.maxCampuses ?? 0);
  const current = Number(campusesCount || 0);
  if (limit > 0 && current > limit) throw new Error(`This plan allows at most ${limit} campus${limit === 1 ? "" : "es"}.`);
  return true;
}

function assertTenantUsageLimits(planLike, usage = {}) {
  const source = planLike?.planSnapshot || planLike || {};
  const checks = [
    ["students", Number(source.maxStudents || 0), Number(usage.students || 0)],
    ["staff", Number(source.maxStaff || 0), Number(usage.staff || 0)],
    ["campuses", Number(source.maxCampuses || 0), Number(usage.campuses || 0)],
  ];
  for (const [label, limit, current] of checks) {
    if (!Number.isFinite(current) || current < 0) throw new Error(`Current ${label} usage is invalid.`);
    if (limit > 0 && current > limit) {
      throw new Error(`The selected plan allows at most ${limit} ${label}, but this school currently uses ${current}.`);
    }
  }
  return true;
}

function assertCustomDomainAllowed(planLike, customDomain) {
  if (!clean(customDomain)) return true;
  const flags = normalizeFeatureFlags(planLike?.featureFlags || planLike?.planSnapshot?.featureFlags || {});
  if (!flags.customDomain) throw new Error("Custom domains are not enabled for this plan.");
  return true;
}

function paymentReferenceKey(provider, reference, tenantId = null) {
  const ref = clean(reference);
  const tenantKey = clean(tenantId?._id || tenantId);
  if (!ref || !tenantKey) return null;
  return `${lower(tenantKey)}:${lower(provider || "manual")}:${lower(ref)}`;
}

function validatePaymentInput(input = {}, { tenant, subscription, now = new Date() } = {}) {
  const type = lower(input.type);
  const provider = lower(input.provider || "manual");
  const requestedStatus = lower(input.status || "completed");
  const amount = finiteNumber(input.amount, NaN);
  const currency = upper(input.currency || subscription?.planSnapshot?.currency || tenant?.currency || "USD");
  const reference = clean(input.reference);
  const current = new Date(now);

  if (!PAYMENT_TYPES.has(type)) throw new Error("Invalid payment type.");
  if (!PAYMENT_PROVIDERS.has(provider)) throw new Error("Invalid payment provider.");
  if (!PAYMENT_CREATE_STATUSES.has(requestedStatus)) throw new Error("New payment records may be pending or completed only.");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error("Payment amount must be greater than zero.");
  if (!/^[A-Z]{3,10}$/.test(currency)) throw new Error("Payment currency is invalid.");
  if (requestedStatus === "completed" && !reference) throw new Error("Completed payments require a reference.");

  const subscriptionType = ["school_subscription", "student_subscription"].includes(type);
  if (subscriptionType && !subscription) throw new Error("A current subscription is required for subscription payments.");
  if (subscriptionType && currency !== upper(subscription.planSnapshot?.currency || "")) {
    throw new Error("Subscription payment currency must match the subscription plan currency.");
  }

  if (subscriptionType) {
    const billingModel = lower(subscription.planSnapshot?.billingModel);
    if (billingModel === "school_only" && type !== "school_subscription") {
      throw new Error("This plan uses school-level subscription billing.");
    }
    if (billingModel === "student_only" && type !== "student_subscription") {
      throw new Error("This plan uses student-level subscription billing.");
    }
    const minimum = type === "school_subscription"
      ? finiteNumber(subscription.planSnapshot?.pricePerSchool, 0)
      : finiteNumber(subscription.planSnapshot?.pricePerStudent, 0);
    if (minimum > 0 && amount + 1e-9 < minimum) {
      throw new Error(`Subscription payment must be at least ${minimum} ${currency}.`);
    }
  }

  let periodStart = normalizeDate(input.periodStart, "Period start");
  let periodEnd = normalizeDate(input.periodEnd, "Period end");
  const paidAt = normalizeDate(input.paidAt, "Paid at") || (requestedStatus === "completed" ? current : null);
  if (paidAt && paidAt.getTime() > current.getTime() + 10 * 60 * 1000) {
    throw new Error("Paid-at time cannot be in the future.");
  }

  if (subscriptionType && requestedStatus === "completed") {
    const existingEnd = normalizeDate(subscription.currentPeriodEnd, "Current period end");
    const canonicalStart = existingEnd && existingEnd > current ? existingEnd : current;
    const interval = lower(subscription.planSnapshot?.billingInterval);

    if (interval === "custom") {
      periodStart = periodStart || canonicalStart;
      periodEnd = periodEnd || null;
      if (!periodEnd) throw new Error("Custom billing intervals require an explicit period end.");
      if (existingEnd && existingEnd > current && periodStart < existingEnd) {
        throw new Error("Renewal period cannot begin before the current paid period ends.");
      }
      if ((!existingEnd || existingEnd <= current) && periodStart.getTime() > current.getTime() + 10 * 60 * 1000) {
        throw new Error("An inactive custom subscription cannot be activated before its paid period begins.");
      }
    } else {
      // Fixed plans derive the paid window from the frozen subscription plan.
      // Browser-supplied dates are intentionally ignored so a monthly payment
      // cannot accidentally or deliberately grant a longer access period.
      periodStart = canonicalStart;
      periodEnd = periodEndForInterval(periodStart, interval);
    }
  }

  if (periodStart && periodEnd && periodEnd <= periodStart) throw new Error("Payment period end must be after period start.");

  return {
    type,
    provider,
    requestedStatus,
    amount,
    currency,
    reference,
    referenceKey: paymentReferenceKey(provider, reference, tenant?._id || tenant),
    periodStart,
    periodEnd,
    paidAt,
  };
}

function subscriptionPaymentProjection(subscription, payment, actorId = null, now = new Date()) {
  if (!["school_subscription", "student_subscription"].includes(lower(payment?.type))) {
    throw new Error("Only subscription payments can activate a subscription.");
  }
  if (lower(payment?.status) !== "completed") throw new Error("Only completed payments can activate a subscription.");
  const next = {
    status: "active",
    currentPeriodStart: payment.periodStart || subscription.currentPeriodStart || new Date(now),
    currentPeriodEnd: payment.periodEnd || subscription.currentPeriodEnd || null,
    trialEndsAt: null,
    suspendedAt: null,
    cancelledAt: null,
    expiredAt: null,
    statusReason: "",
    lastPaymentId: payment._id,
    lastBilledAt: payment.paidAt || new Date(now),
    updatedBy: actorId || null,
  };
  return next;
}

function subscriptionPlanAsAccessPlan(subscription) {
  if (!subscription?.planSnapshot) return null;
  return {
    _id: subscription.planId,
    revision: subscription.planSnapshot.planRevision,
    name: subscription.planSnapshot.name,
    code: subscription.planSnapshot.code,
    billingModel: subscription.planSnapshot.billingModel,
    pricePerSchool: subscription.planSnapshot.pricePerSchool,
    pricePerStudent: subscription.planSnapshot.pricePerStudent,
    platformSharePercent: subscription.planSnapshot.platformSharePercent,
    currency: subscription.planSnapshot.currency,
    billingInterval: subscription.planSnapshot.billingInterval,
    trialDays: subscription.planSnapshot.trialDays,
    maxStudents: subscription.planSnapshot.maxStudents,
    maxStaff: subscription.planSnapshot.maxStaff,
    maxCampuses: subscription.planSnapshot.maxCampuses,
    enabledModules: subscription.planSnapshot.enabledModules || [],
    featureFlags: subscription.planSnapshot.featureFlags || {},
    isActive: true,
    isDeleted: false,
  };
}

function historyEntry({ action, fromStatus = "", toStatus = "", reason = "", actorId = null, planId = null, paymentId = null, revision }) {
  return {
    at: new Date(),
    action: clean(action),
    fromStatus: lower(fromStatus),
    toStatus: lower(toStatus),
    reason: clean(reason).slice(0, 500),
    actorId: actorId || undefined,
    planId: planId || undefined,
    paymentId: paymentId || undefined,
    revision: revision ? Number(revision) : undefined,
  };
}

function claimToken() {
  return crypto.randomBytes(16).toString("hex");
}


function validateManualActivationInput(input = {}, now = new Date()) {
  const reason = clean(input.reason).slice(0, 500);
  if (reason.length < 8) throw new Error("A manual activation reason of at least 8 characters is required.");
  const start = new Date(now);
  if (Number.isNaN(start.getTime())) throw new Error("Manual activation start time is invalid.");
  const periodEnd = normalizeDate(input.periodEnd, "Manual activation period end");
  if (!periodEnd || periodEnd <= start) throw new Error("Manual activation requires a future period end date.");
  const maxEnd = new Date(start);
  maxEnd.setUTCFullYear(maxEnd.getUTCFullYear() + 5);
  if (periodEnd > maxEnd) throw new Error("Manual activation cannot grant more than five years of access.");
  return { reason, periodStart: start, periodEnd };
}

module.exports = {
  validateManualActivationInput,
  OPERATIONAL_STATUSES,
  SUBSCRIPTION_STATUSES,
  TENANT_STATUSES,
  PAYMENT_TYPES,
  PAYMENT_PROVIDERS,
  PAYMENT_CREATE_STATUSES,
  clean,
  lower,
  upper,
  finiteNumber,
  integer,
  positiveRevision,
  bool,
  normalizeFeatureFlags,
  normalizeModules,
  validatePlanInput,
  snapshotPlan,
  periodEndForInterval,
  normalizeDate,
  buildInitialSubscription,
  subscriptionEffectiveStatus,
  isSubscriptionOperational,
  tenantProjectionFromSubscription,
  assertSubscriptionTransition,
  mapTenantStatusToSubscription,
  assertCampusLimit,
  assertTenantUsageLimits,
  assertCustomDomainAllowed,
  paymentReferenceKey,
  validatePaymentInput,
  subscriptionPaymentProjection,
  subscriptionPlanAsAccessPlan,
  historyEntry,
  claimToken,
};
