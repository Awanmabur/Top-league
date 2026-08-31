const { platformConnection } = require("../../config/db");
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformPayment = require("../../models/platform/PlatformPayment")(platformConnection);
const PlatformSubscription = require("../../models/platform/PlatformSubscription")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const { subscriptionEffectiveStatus } = require("../../services/platformSubscriptionService");
const reports = require("../../services/platformReportsService");

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: "PlatformReport",
      entityId: payload.entityId || "",
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("Platform report audit failed:", err);
  }
}

async function loadSubscriptions() {
  return PlatformSubscription.find({ isDeleted: { $ne: true } })
    .select("tenantId planId planSnapshot status trialEndsAt currentPeriodStart currentPeriodEnd lastBilledAt revision")
    .lean();
}

async function tenantRows() {
  const [tenants, subscriptions] = await Promise.all([
    Tenant.find({ isDeleted: { $ne: true } })
      .select("name code ownerName ownerEmail country currency status planName planId dbName createdAt provisioningStatus")
      .sort({ createdAt: -1 })
      .lean(),
    loadSubscriptions(),
  ]);
  const subByTenant = new Map(subscriptions.map((sub) => [String(sub.tenantId), sub]));
  return tenants.map((tenant) => {
    const subscription = subByTenant.get(String(tenant._id));
    return {
      ...tenant,
      status: subscription ? subscriptionEffectiveStatus(subscription) : "unsubscribed",
      planId: subscription ? { _id: subscription.planId, name: subscription.planSnapshot?.name || tenant.planName || "" } : null,
      planName: subscription?.planSnapshot?.name || tenant.planName || "",
      subscriptionRevision: subscription?.revision || null,
      subscriptionEndsAt: subscription?.currentPeriodEnd || subscription?.trialEndsAt || null,
    };
  });
}

async function planRows() {
  const [plans, subscriptions] = await Promise.all([
    Plan.find({ isDeleted: { $ne: true } }).sort({ sortOrder: 1, name: 1 }).lean(),
    loadSubscriptions(),
  ]);
  const byPlan = new Map();
  for (const sub of subscriptions) {
    const key = String(sub.planId || "");
    if (!key) continue;
    const bucket = byPlan.get(key) || { totalTenants: 0, operationalTenants: 0 };
    bucket.totalTenants += 1;
    if (["active", "trial"].includes(subscriptionEffectiveStatus(sub))) bucket.operationalTenants += 1;
    byPlan.set(key, bucket);
  }
  return plans.map((plan) => ({ ...plan, ...(byPlan.get(String(plan._id)) || { totalTenants: 0, operationalTenants: 0 }) }));
}

async function paymentRows() {
  return PlatformPayment.find({})
    .select("tenantId planId subscriptionId subscriptionRevision type amount currency reference provider status periodStart periodEnd paidAt createdAt")
    .populate("tenantId", "name code")
    .populate("planId", "name code")
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();
}

function sendCsv(res, filename, rows) {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.attachment(filename);
  res.type("text/csv; charset=utf-8");
  return res.send(reports.csv(rows));
}

module.exports = {
  reportsHome: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const [tenantCount, planCount, subscriptions, payments] = await Promise.all([
        Tenant.countDocuments({ isDeleted: { $ne: true } }),
        Plan.countDocuments({ isDeleted: { $ne: true } }),
        loadSubscriptions(),
        PlatformPayment.find({ status: "completed" }).select("type amount status").lean(),
      ]);
      const statuses = reports.summarizeSubscriptions(subscriptions);
      return res.render("platform/reports/index", {
        summary: {
          tenantCount,
          activeCount: statuses.active,
          trialCount: statuses.trial,
          suspendedCount: statuses.suspended + statuses.past_due + statuses.expired,
          planCount,
          paymentCount: payments.length,
          totalRevenue: reports.netRevenue(payments),
        },
        user: req.user || null,
        error: null,
      });
    } catch (err) {
      console.error("reportsHome error:", err);
      return res.status(500).render("platform/reports/index", { summary: null, error: "Failed to load reports dashboard." });
    }
  },

  tenantReport: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.render("platform/reports/tenants", { rows: await tenantRows(), error: null });
    } catch (err) {
      return res.status(500).render("platform/reports/tenants", { rows: [], error: "Failed to load tenant report." });
    }
  },

  planReport: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.render("platform/reports/plans", { rows: await planRows(), error: null });
    } catch (err) {
      return res.status(500).render("platform/reports/plans", { rows: [], error: "Failed to load plan report." });
    }
  },

  paymentReport: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.render("platform/reports/payments", { rows: await paymentRows(), error: null });
    } catch (err) {
      return res.status(500).render("platform/reports/payments", { rows: [], error: "Failed to load payment report." });
    }
  },

  exportTenantReport: async (req, res) => {
    const rows = await tenantRows();
    await writeAudit(req, { action: "Export Platform Tenant Report", description: `Exported ${rows.length} tenant report rows` });
    return sendCsv(res, "platform-tenants.csv", [["School", "Code", "Owner", "Owner Email", "Plan", "Subscription Status", "Subscription End", "Country", "Currency", "Provisioning"], ...rows.map((r) => [r.name, r.code, r.ownerName, r.ownerEmail, r.planName, r.status, r.subscriptionEndsAt ? new Date(r.subscriptionEndsAt).toISOString() : "", r.country, r.currency, r.provisioningStatus])]);
  },

  exportPlanReport: async (req, res) => {
    const rows = await planRows();
    await writeAudit(req, { action: "Export Platform Plan Report", description: `Exported ${rows.length} plan report rows` });
    return sendCsv(res, "platform-plans.csv", [["Plan", "Code", "Billing Model", "Interval", "Currency", "School Price", "Student Price", "Total Tenants", "Operational Tenants"], ...rows.map((r) => [r.name, r.code, r.billingModel, r.billingInterval, r.currency, r.pricePerSchool, r.pricePerStudent, r.totalTenants, r.operationalTenants])]);
  },

  exportPaymentReport: async (req, res) => {
    const rows = await paymentRows();
    await writeAudit(req, { action: "Export Platform Payment Report", description: `Exported ${rows.length} platform payment rows` });
    return sendCsv(res, "platform-payments.csv", [["School", "Plan", "Type", "Amount", "Currency", "Provider", "Reference", "Status", "Paid At", "Period Start", "Period End"], ...rows.map((r) => [r.tenantId?.name || "", r.planId?.name || "", r.type, r.amount, r.currency, r.provider, r.reference, r.status, r.paidAt ? new Date(r.paidAt).toISOString() : "", r.periodStart ? new Date(r.periodStart).toISOString() : "", r.periodEnd ? new Date(r.periodEnd).toISOString() : ""])]);
  },
};
