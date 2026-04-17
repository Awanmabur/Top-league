const { platformConnection } = require("../../config/db");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformPayment = require("../../models/platform/PlatformPayment")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function safeTrim(v) {
  return String(v || "").trim();
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "PlatformPayment",
      entityId: payload.entityId ? String(payload.entityId) : "",
      tenantId: payload.tenantId || null,
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("❌ billing audit log failed:", err);
  }
}

module.exports = {
  billingSubscriptionsPage: async (req, res) => {
    try {
      const tenants = await Tenant.find({
        isDeleted: { $ne: true },
      })
        .populate("planId")
        .sort({ createdAt: -1 })
        .lean();

      const recentPayments = await PlatformPayment.find({})
        .populate("tenantId")
        .populate("planId")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      return res.render("platform/billing/index", {
        tenants,
        recentPayments,
        error: null,
      });
    } catch (err) {
      console.error("❌ billingSubscriptionsPage error:", err);
      return res.status(500).render("platform/billing/index", {
        tenants: [],
        recentPayments: [],
        error: "Failed to load billing page.",
      });
    }
  },

  recordPaymentForm: async (req, res) => {
    try {
      const [tenants, plans] = await Promise.all([
        Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean(),
        Plan.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).lean(),
      ]);

      return res.render("platform/billing/create-payment", {
        tenants,
        plans,
        old: {},
        error: null,
      });
    } catch (err) {
      console.error("❌ recordPaymentForm error:", err);
      return res.status(500).render("platform/billing/create-payment", {
        tenants: [],
        plans: [],
        old: {},
        error: "Failed to load payment form.",
      });
    }
  },

  recordPayment: async (req, res) => {
    try {
      const {
        tenantId,
        planId,
        type,
        amount,
        currency,
        reference,
        provider,
        status,
        periodStart,
        periodEnd,
        paidAt,
        notes,
      } = req.body;

      if (!tenantId || !type || !amount) {
        const [tenants, plans] = await Promise.all([
          Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean(),
          Plan.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).lean(),
        ]);

        return res.status(400).render("platform/billing/create-payment", {
          tenants,
          plans,
          old: req.body,
          error: "Tenant, payment type, and amount are required.",
        });
      }

      const tenant = await Tenant.findOne({
        _id: tenantId,
        isDeleted: { $ne: true },
      }).lean();

      if (!tenant) {
        const [tenants, plans] = await Promise.all([
          Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean(),
          Plan.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).lean(),
        ]);

        return res.status(400).render("platform/billing/create-payment", {
          tenants,
          plans,
          old: req.body,
          error: "Selected school is invalid.",
        });
      }

      const payment = await PlatformPayment.create({
        tenantId,
        planId: planId || undefined,
        type,
        amount: toNumber(amount, 0),
        currency: safeTrim(currency || "USD").toUpperCase(),
        reference: safeTrim(reference),
        provider: safeTrim(provider || "manual"),
        status: safeTrim(status || "completed"),
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
        paidAt: paidAt || undefined,
        notes: safeTrim(notes),
        createdBy: req.user?._id || null,
      });

      await writeAudit(req, {
        action: "Create Platform Payment",
        entityId: payment._id,
        tenantId: payment.tenantId,
        description: `Recorded payment ${payment.reference || payment._id} for tenant ${tenant.name}`,
        meta: {
          amount: payment.amount,
          type: payment.type,
          status: payment.status,
        },
      });

      return res.redirect("/super-admin/billing-subscriptions");
    } catch (err) {
      console.error("❌ recordPayment error:", err);

      const [tenants, plans] = await Promise.all([
        Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean(),
        Plan.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).lean(),
      ]);

      return res.status(500).render("platform/billing/create-payment", {
        tenants,
        plans,
        old: req.body,
        error: err?.message || "Failed to record payment.",
      });
    }
  },
};
