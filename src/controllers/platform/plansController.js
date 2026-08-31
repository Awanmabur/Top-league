const { platformConnection } = require("../../config/db");

const Plan = require("../../models/platform/Plan")(platformConnection);
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const PlatformSubscription = require("../../models/platform/PlatformSubscription")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const {
  bool,
  clean,
  lower,
  positiveRevision,
  validatePlanInput,
} = require("../../services/platformSubscriptionService");

function safeTrim(v) {
  return String(v || "").trim();
}

function normalizePlanCode(value, fallbackName = "") {
  const source = lower(value || fallbackName);
  const code = source.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!code || code.length > 60) throw new Error("Plan code is invalid.");
  return code;
}

function planPayload(body = {}, current = null) {
  const name = clean(body.name);
  if (!name) throw new Error("Plan name is required.");
  const code = normalizePlanCode(body.code, name);
  const validated = validatePlanInput({
    ...body,
    featureFlags: {
      customDomain: bool(body.customDomain),
      apiAccess: bool(body.apiAccess),
      prioritySupport: bool(body.prioritySupport),
      whiteLabel: bool(body.whiteLabel),
      advancedReports: bool(body.advancedReports),
      helpdesk: bool(body.helpdesk),
      backups: body.backups === undefined ? current?.featureFlags?.backups !== false : bool(body.backups),
      systemHealth: body.systemHealth === undefined ? current?.featureFlags?.systemHealth !== false : bool(body.systemHealth),
    },
  });

  return {
    name,
    code,
    description: safeTrim(body.description).slice(0, 1000),
    ...validated,
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    isPublic: bool(body.isPublic),
    isActive: bool(body.isActive),
  };
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "Plan",
      entityId: payload.entityId ? String(payload.entityId) : "",
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("plan audit log failed:", err);
  }
}

module.exports = {
  listPlans: async (req, res) => {
    try {
      const plans = await Plan.find({ isDeleted: { $ne: true } })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
      const planIds = plans.map((p) => p._id);
      const usage = planIds.length
        ? await PlatformSubscription.aggregate([
            { $match: { isDeleted: { $ne: true }, planId: { $in: planIds } } },
            { $group: { _id: "$planId", totalTenants: { $sum: 1 } } },
          ])
        : [];
      const usageMap = new Map(usage.map((u) => [String(u._id), u.totalTenants]));
      const rows = plans.map((plan) => ({ ...plan, totalTenants: usageMap.get(String(plan._id)) || 0 }));
      return res.render("platform/plans/index", { plans: rows, user: req.user || null, error: null });
    } catch (err) {
      console.error("listPlans error:", err);
      return res.status(500).render("platform/plans/index", { plans: [], error: "Failed to load plans." });
    }
  },

  createPlanForm: async (req, res) => res.render("platform/plans/create", { old: {}, error: null }),

  createPlan: async (req, res) => {
    try {
      const payload = planPayload(req.body);
      const existing = await Plan.findOne({
        $or: [{ name: payload.name }, { code: payload.code }],
        isDeleted: { $ne: true },
      }).lean();
      if (existing) return res.status(400).render("platform/plans/create", { old: req.body, error: "Plan name or code already exists." });

      const plan = await Plan.create({
        ...payload,
        revision: 1,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });
      await writeAudit(req, {
        action: "Create Plan",
        entityId: plan._id,
        description: `Created plan ${plan.name}`,
        meta: { code: plan.code, billingModel: plan.billingModel, revision: plan.revision },
      });
      return res.redirect("/super-admin/plans");
    } catch (err) {
      console.error("createPlan error:", err);
      return res.status(400).render("platform/plans/create", { old: req.body, error: err?.message || "Failed to create plan." });
    }
  },

  editPlanForm: async (req, res) => {
    try {
      const plan = await Plan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!plan) return res.status(404).render("platform/plans/edit", { plan: null, error: "Plan not found." });
      return res.render("platform/plans/edit", { plan, error: null });
    } catch (err) {
      console.error("editPlanForm error:", err);
      return res.status(500).render("platform/plans/edit", { plan: null, error: "Failed to load plan form." });
    }
  },

  updatePlan: async (req, res) => {
    try {
      const expectedRevision = positiveRevision(req.body.revision);
      const current = await Plan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!current) return res.status(404).send("Plan not found.");
      if (Number(current.revision || 1) !== expectedRevision) return res.status(409).send("Plan changed since the page was loaded. Reload and try again.");

      const payload = planPayload(req.body, current);
      const duplicate = await Plan.findOne({
        _id: { $ne: current._id },
        $or: [{ name: payload.name }, { code: payload.code }],
        isDeleted: { $ne: true },
      }).lean();
      if (duplicate) {
        return res.status(400).render("platform/plans/edit", {
          plan: { ...current, ...req.body, revision: expectedRevision },
          error: "Another plan already uses that name or code.",
        });
      }

      const update = await Plan.updateOne(
        { _id: current._id, isDeleted: { $ne: true }, revision: expectedRevision },
        { $set: { ...payload, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
      );
      if (update.modifiedCount !== 1) return res.status(409).send("Plan changed since the page was loaded. Reload and try again.");

      await writeAudit(req, {
        action: "Update Plan",
        entityId: current._id,
        description: `Updated plan ${payload.name}`,
        meta: { code: payload.code, billingModel: payload.billingModel, revision: expectedRevision + 1 },
      });
      return res.redirect("/super-admin/plans");
    } catch (err) {
      console.error("updatePlan error:", err);
      const code = /revision/i.test(String(err?.message || "")) ? 409 : 400;
      return res.status(code).render("platform/plans/edit", {
        plan: { ...req.body, _id: req.params.id, revision: req.body.revision || 1 },
        error: err?.message || "Failed to update plan.",
      });
    }
  },

  deletePlan: async (req, res) => {
    try {
      const expectedRevision = positiveRevision(req.body.revision);
      const plan = await Plan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!plan) return res.status(404).send("Plan not found.");
      if (Number(plan.revision || 1) !== expectedRevision) return res.status(409).send("Plan changed since the page was loaded. Reload and try again.");

      const [subscriptionsUsingPlan, legacyTenantsUsingPlan] = await Promise.all([
        PlatformSubscription.countDocuments({ planId: plan._id, isDeleted: { $ne: true } }),
        Tenant.countDocuments({ planId: plan._id, isDeleted: { $ne: true }, subscriptionId: { $exists: false } }),
      ]);
      if (subscriptionsUsingPlan > 0 || legacyTenantsUsingPlan > 0) {
        return res.status(400).send("Cannot delete a plan referenced by a current school subscription.");
      }

      const update = await Plan.updateOne(
        { _id: plan._id, isDeleted: { $ne: true }, revision: expectedRevision },
        { $set: { isDeleted: true, isActive: false, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
      );
      if (update.modifiedCount !== 1) return res.status(409).send("Plan changed since the page was loaded. Reload and try again.");

      await writeAudit(req, { action: "Delete Plan", entityId: plan._id, description: `Soft deleted plan ${plan.name}`, meta: { revision: expectedRevision + 1 } });
      return res.redirect("/super-admin/plans");
    } catch (err) {
      console.error("deletePlan error:", err);
      return res.status(/revision/i.test(String(err?.message || "")) ? 409 : 400).send(err?.message || "Failed to delete plan.");
    }
  },
};
