const { platformConnection } = require("../../config/db");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformSubscription = require("../../models/platform/PlatformSubscription")(platformConnection);
const PlatformPayment = require("../../models/platform/PlatformPayment")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const {
  historyEntry,
  positiveRevision,
  subscriptionEffectiveStatus,
  subscriptionPaymentProjection,
  tenantProjectionFromSubscription,
  validatePaymentInput,
} = require("../../services/platformSubscriptionService");
const { invalidateTenantAccess } = require("../../services/platformTenantAccessCache");
const { invalidatePublicSchoolCache } = require("../../services/platformPublicCacheService");

function safeTrim(v) {
  return String(v || "").trim();
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
    console.error("billing audit log failed:", err);
  }
}

async function withPlatformTransaction(work) {
  const session = await platformConnection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function loadBillingChoices() {
  const subscriptions = await PlatformSubscription.find({
    isDeleted: { $ne: true },
    migrationQuarantined: { $ne: true },
  })
    .populate("tenantId")
    .populate("planId")
    .sort({ updatedAt: -1 })
    .lean();

  return subscriptions.filter((row) => row.tenantId && !row.tenantId.isDeleted);
}

module.exports = {
  billingSubscriptionsPage: async (req, res) => {
    try {
      const [subscriptionsRaw, recentPayments] = await Promise.all([
        PlatformSubscription.find({ isDeleted: { $ne: true } })
          .populate("tenantId")
          .populate("planId")
          .populate("lastPaymentId")
          .sort({ updatedAt: -1 })
          .lean(),
        PlatformPayment.find({})
          .populate("tenantId")
          .populate("planId")
          .populate("subscriptionId")
          .sort({ createdAt: -1 })
          .limit(50)
          .lean(),
      ]);
      const subscriptions = subscriptionsRaw
        .filter((row) => row.tenantId)
        .map((row) => ({ ...row, effectiveStatus: subscriptionEffectiveStatus(row) }));

      return res.render("platform/billing/index", {
        subscriptions,
        recentPayments,
        error: null,
      });
    } catch (err) {
      console.error("billingSubscriptionsPage error:", err);
      return res.status(500).render("platform/billing/index", {
        subscriptions: [],
        recentPayments: [],
        error: "Failed to load billing page.",
      });
    }
  },

  recordPaymentForm: async (req, res) => {
    try {
      return res.render("platform/billing/create-payment", {
        subscriptions: await loadBillingChoices(),
        old: {},
        error: null,
      });
    } catch (err) {
      console.error("recordPaymentForm error:", err);
      return res.status(500).render("platform/billing/create-payment", {
        subscriptions: [],
        old: {},
        error: "Failed to load payment form.",
      });
    }
  },

  recordPayment: async (req, res) => {
    try {
      const tenantId = safeTrim(req.body.tenantId);
      const claimedSubscriptionId = safeTrim(req.body.subscriptionId);
      let claimedSubscriptionRevision;
      try { claimedSubscriptionRevision = positiveRevision(req.body.subscriptionRevision); }
      catch (_) { claimedSubscriptionRevision = null; }
      if (!tenantId || !claimedSubscriptionId || !claimedSubscriptionRevision || !req.body.type || !req.body.amount) {
        return res.status(400).render("platform/billing/create-payment", {
          subscriptions: await loadBillingChoices(),
          old: req.body,
          error: "Tenant, payment type, and amount are required.",
        });
      }

      const [tenant, subscription] = await Promise.all([
        Tenant.findOne({ _id: tenantId, isDeleted: { $ne: true } }).lean(),
        PlatformSubscription.findOne({ tenantId, isDeleted: { $ne: true } }).lean(),
      ]);
      if (!tenant || !subscription || subscription.migrationQuarantined) {
        return res.status(400).render("platform/billing/create-payment", {
          subscriptions: await loadBillingChoices(),
          old: req.body,
          error: "Selected school does not have a usable current subscription.",
        });
      }
      if (String(subscription._id) !== claimedSubscriptionId || Number(subscription.revision || 1) !== claimedSubscriptionRevision) {
        return res.status(409).render("platform/billing/create-payment", {
          subscriptions: await loadBillingChoices(),
          old: req.body,
          error: "The selected subscription changed after this form was loaded. Reload and review the current plan before recording payment.",
        });
      }
      if (subscription.status === "cancelled") throw new Error("Cancelled subscriptions cannot receive a normal renewal payment.");
      if (req.body.planId && String(req.body.planId) !== String(subscription.planId)) {
        throw new Error("Payment plan must match the tenant's current subscription plan.");
      }

      const validated = validatePaymentInput(
        { ...req.body, status: "completed" },
        { tenant, subscription },
      );
      if (validated.referenceKey) {
        const duplicate = await PlatformPayment.findOne({
          referenceKey: validated.referenceKey,
          migrationQuarantined: { $ne: true },
        }).lean();
        if (duplicate) throw new Error("This provider/reference payment is already recorded.");
      }

      const subscriptionType = ["school_subscription", "student_subscription"].includes(validated.type);
      const result = await withPlatformTransaction(async (session) => {
        const currentTenant = await Tenant.findOne({
          _id: tenant._id,
          isDeleted: { $ne: true },
          revision: Number(tenant.revision || 1),
        }).session(session);
        if (!currentTenant) throw new Error("Tenant changed while recording payment. Reload and try again.");
        const currentSubscription = await PlatformSubscription.findOne({
          _id: claimedSubscriptionId,
          tenantId: tenant._id,
          isDeleted: { $ne: true },
          revision: claimedSubscriptionRevision,
        }).session(session);
        if (!currentSubscription) throw new Error("Subscription changed while recording payment. Reload and try again.");
        if (currentSubscription.status === "cancelled") throw new Error("Cancelled subscriptions cannot receive a normal renewal payment.");

        const [payment] = await PlatformPayment.create([{
          tenantId: tenant._id,
          planId: currentSubscription.planId,
          subscriptionId: currentSubscription._id,
          subscriptionRevision: Number(currentSubscription.revision || 1),
          type: validated.type,
          amount: validated.amount,
          currency: validated.currency,
          reference: validated.reference,
          referenceKey: validated.referenceKey || undefined,
          provider: validated.provider,
          status: "completed",
          periodStart: validated.periodStart || undefined,
          periodEnd: validated.periodEnd || undefined,
          paidAt: validated.paidAt || new Date(),
          notes: safeTrim(req.body.notes).slice(0, 1000),
          meta: { source: "platform_manual_billing" },
          createdBy: req.user?._id || null,
          revision: 1,
        }], { session });

        let nextSubscriptionRevision = Number(currentSubscription.revision || 1);
        if (subscriptionType) {
          const projection = subscriptionPaymentProjection(currentSubscription, payment, req.user?._id || null);
          nextSubscriptionRevision += 1;
          const subUpdate = await PlatformSubscription.updateOne(
            { _id: currentSubscription._id, revision: Number(currentSubscription.revision || 1), isDeleted: { $ne: true } },
            {
              $set: projection,
              $inc: { revision: 1 },
              $push: {
                history: historyEntry({
                  action: "subscription_payment_completed",
                  fromStatus: subscriptionEffectiveStatus(currentSubscription),
                  toStatus: "active",
                  actorId: req.user?._id || null,
                  planId: currentSubscription.planId,
                  paymentId: payment._id,
                  revision: nextSubscriptionRevision,
                }),
              },
            },
            { session },
          );
          if (subUpdate.modifiedCount !== 1) throw new Error("Subscription changed while recording payment. Reload and try again.");

          const projectedSubscription = {
            ...currentSubscription.toObject(),
            ...projection,
            _id: currentSubscription._id,
            revision: nextSubscriptionRevision,
          };
          const tenantProjection = tenantProjectionFromSubscription(projectedSubscription);
          const tenantUpdate = await Tenant.updateOne(
            { _id: currentTenant._id, revision: Number(currentTenant.revision || 1), isDeleted: { $ne: true } },
            {
              $set: {
                ...tenantProjection,
                statusReason: "",
                suspendedAt: null,
                cancelledAt: null,
                updatedBy: req.user?._id || null,
              },
              $inc: { revision: 1 },
            },
            { session },
          );
          if (tenantUpdate.modifiedCount !== 1) throw new Error("Tenant changed while recording payment. Reload and try again.");
        }

        return { payment, nextSubscriptionRevision };
      });

      await invalidateTenantAccess(tenant).catch((err) => {
        console.error("tenant access cache invalidation failed:", err?.message || err);
      });
      await invalidatePublicSchoolCache();
      await writeAudit(req, {
        action: "Create Platform Payment",
        entityId: result.payment._id,
        tenantId: result.payment.tenantId,
        description: `Recorded completed payment ${result.payment.reference || result.payment._id} for tenant ${tenant.name}`,
        meta: {
          amount: result.payment.amount,
          currency: result.payment.currency,
          type: result.payment.type,
          status: result.payment.status,
          subscriptionId: String(subscription._id),
          subscriptionRevision: result.nextSubscriptionRevision,
        },
      });

      return res.redirect("/super-admin/billing-subscriptions");
    } catch (err) {
      console.error("recordPayment error:", err);
      return res.status(400).render("platform/billing/create-payment", {
        subscriptions: await loadBillingChoices().catch(() => []),
        old: req.body,
        error: err?.message || "Failed to record payment.",
      });
    }
  },
};
