const { platformConnection } = require("../../config/db");

const Plan = require("../../models/platform/Plan")(platformConnection);
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function safeTrim(v) {
  return String(v || "").trim();
}

function safeLower(v) {
  return String(v || "").trim().toLowerCase();
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeArray(v) {
  if (Array.isArray(v)) return v.map((x) => safeTrim(x)).filter(Boolean);
  if (!safeTrim(v)) return [];
  return String(v)
    .split(",")
    .map((x) => safeTrim(x))
    .filter(Boolean);
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
    console.error("❌ plan audit log failed:", err);
  }
}

module.exports = {
  listPlans: async (req, res) => {
    try {
      const plans = await Plan.find({
        isDeleted: { $ne: true },
      })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

      const planIds = plans.map((p) => p._id);
      const usage = await Tenant.aggregate([
        {
          $match: {
            isDeleted: { $ne: true },
            planId: { $in: planIds },
          },
        },
        {
          $group: {
            _id: "$planId",
            totalTenants: { $sum: 1 },
          },
        },
      ]);

      const usageMap = new Map(usage.map((u) => [String(u._id), u.totalTenants]));

      const rows = plans.map((plan) => ({
        ...plan,
        totalTenants: usageMap.get(String(plan._id)) || 0,
      }));

      return res.render("platform/plans/index", {
        plans: rows,
        user: req.user || null,
        error: null,
      });
    } catch (err) {
      console.error("❌ listPlans error:", err);
      return res.status(500).render("platform/plans/index", {
        plans: [],
        error: "Failed to load plans.",
      });
    }
  },

  createPlanForm: async (req, res) => {
    return res.render("platform/plans/create", {
      old: {},
      error: null,
    });
  },

  createPlan: async (req, res) => {
    try {
      const {
        name,
        code,
        description,
        billingModel,
        pricePerSchool,
        pricePerStudent,
        platformSharePercent,
        currency,
        billingInterval,
        trialDays,
        maxStudents,
        maxStaff,
        maxCampuses,
        enabledModules,
        sortOrder,
        isPublic,
        isActive,
        customDomain,
        apiAccess,
        prioritySupport,
        whiteLabel,
        advancedReports,
      } = req.body;

      const cleanName = safeTrim(name);
      const cleanCode = safeLower(code);

      if (!cleanName || !billingModel) {
        return res.status(400).render("platform/plans/create", {
          old: req.body,
          error: "Plan name and billing model are required.",
        });
      }

      const existing = await Plan.findOne({
        $or: [{ name: cleanName }, { code: cleanCode || safeLower(cleanName) }],
        isDeleted: { $ne: true },
      }).lean();

      if (existing) {
        return res.status(400).render("platform/plans/create", {
          old: req.body,
          error: "Plan name or code already exists.",
        });
      }

      const plan = await Plan.create({
        name: cleanName,
        code: cleanCode || safeLower(cleanName).replace(/\s+/g, "-"),
        description: safeTrim(description),
        billingModel,
        pricePerSchool: toNumber(pricePerSchool, 0),
        pricePerStudent: toNumber(pricePerStudent, 0),
        platformSharePercent: toNumber(platformSharePercent, 0),
        currency: safeTrim(currency || "USD").toUpperCase(),
        billingInterval: safeLower(billingInterval || "monthly"),
        trialDays: toNumber(trialDays, 0),
        maxStudents: toNumber(maxStudents, 0),
        maxStaff: toNumber(maxStaff, 0),
        maxCampuses: toNumber(maxCampuses, 1),
        enabledModules: normalizeArray(enabledModules),
        sortOrder: toNumber(sortOrder, 0),
        isPublic: !!(isPublic === "on" || isPublic === "true"),
        isActive: !!(isActive === "on" || isActive === "true"),
        featureFlags: {
          customDomain: !!(customDomain === "on" || customDomain === "true"),
          apiAccess: !!(apiAccess === "on" || apiAccess === "true"),
          prioritySupport: !!(prioritySupport === "on" || prioritySupport === "true"),
          whiteLabel: !!(whiteLabel === "on" || whiteLabel === "true"),
          advancedReports: !!(advancedReports === "on" || advancedReports === "true"),
        },
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      await writeAudit(req, {
        action: "Create Plan",
        entityId: plan._id,
        description: `Created plan ${plan.name}`,
        meta: {
          code: plan.code,
          billingModel: plan.billingModel,
        },
      });

      return res.redirect("/super-admin/plans");
    } catch (err) {
      console.error("❌ createPlan error:", err);
      return res.status(500).render("platform/plans/create", {
        old: req.body,
        error: err?.message || "Failed to create plan.",
      });
    }
  },

  editPlanForm: async (req, res) => {
    try {
      const plan = await Plan.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      }).lean();

      if (!plan) {
        return res.status(404).render("platform/plans/edit", {
          plan: null,
          error: "Plan not found.",
        });
      }

      return res.render("platform/plans/edit", {
        plan,
        error: null,
      });
    } catch (err) {
      console.error("❌ editPlanForm error:", err);
      return res.status(500).render("platform/plans/edit", {
        plan: null,
        error: "Failed to load plan form.",
      });
    }
  },

  updatePlan: async (req, res) => {
    try {
      const plan = await Plan.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!plan) {
        return res.status(404).send("Plan not found.");
      }

      const {
        name,
        code,
        description,
        billingModel,
        pricePerSchool,
        pricePerStudent,
        platformSharePercent,
        currency,
        billingInterval,
        trialDays,
        maxStudents,
        maxStaff,
        maxCampuses,
        enabledModules,
        sortOrder,
        isPublic,
        isActive,
        customDomain,
        apiAccess,
        prioritySupport,
        whiteLabel,
        advancedReports,
      } = req.body;

      const cleanName = safeTrim(name);
      const cleanCode = safeLower(code);

      if (!cleanName || !billingModel) {
        return res.status(400).render("platform/plans/edit", {
          plan: { ...plan.toObject(), ...req.body },
          error: "Plan name and billing model are required.",
        });
      }

      const duplicate = await Plan.findOne({
        _id: { $ne: plan._id },
        $or: [{ name: cleanName }, { code: cleanCode }],
        isDeleted: { $ne: true },
      }).lean();

      if (duplicate) {
        return res.status(400).render("platform/plans/edit", {
          plan: { ...plan.toObject(), ...req.body },
          error: "Another plan already uses that name or code.",
        });
      }

      plan.name = cleanName;
      plan.code = cleanCode || plan.code;
      plan.description = safeTrim(description);
      plan.billingModel = billingModel;
      plan.pricePerSchool = toNumber(pricePerSchool, 0);
      plan.pricePerStudent = toNumber(pricePerStudent, 0);
      plan.platformSharePercent = toNumber(platformSharePercent, 0);
      plan.currency = safeTrim(currency || "USD").toUpperCase();
      plan.billingInterval = safeLower(billingInterval || "monthly");
      plan.trialDays = toNumber(trialDays, 0);
      plan.maxStudents = toNumber(maxStudents, 0);
      plan.maxStaff = toNumber(maxStaff, 0);
      plan.maxCampuses = toNumber(maxCampuses, 1);
      plan.enabledModules = normalizeArray(enabledModules);
      plan.sortOrder = toNumber(sortOrder, 0);
      plan.isPublic = !!(isPublic === "on" || isPublic === "true");
      plan.isActive = !!(isActive === "on" || isActive === "true");
      plan.featureFlags = {
        customDomain: !!(customDomain === "on" || customDomain === "true"),
        apiAccess: !!(apiAccess === "on" || apiAccess === "true"),
        prioritySupport: !!(prioritySupport === "on" || prioritySupport === "true"),
        whiteLabel: !!(whiteLabel === "on" || whiteLabel === "true"),
        advancedReports: !!(advancedReports === "on" || advancedReports === "true"),
      };
      plan.updatedBy = req.user?._id || null;

      await plan.save();

      await writeAudit(req, {
        action: "Update Plan",
        entityId: plan._id,
        description: `Updated plan ${plan.name}`,
        meta: {
          code: plan.code,
          billingModel: plan.billingModel,
        },
      });

      return res.redirect("/super-admin/plans");
    } catch (err) {
      console.error("❌ updatePlan error:", err);
      return res.status(500).render("platform/plans/edit", {
        plan: req.body,
        error: err?.message || "Failed to update plan.",
      });
    }
  },

  deletePlan: async (req, res) => {
    try {
      const plan = await Plan.findOne({
        _id: req.params.id,
        isDeleted: { $ne: true },
      });

      if (!plan) {
        return res.status(404).send("Plan not found.");
      }

      const tenantsUsingPlan = await Tenant.countDocuments({
        planId: plan._id,
        isDeleted: { $ne: true },
      });

      if (tenantsUsingPlan > 0) {
        return res.status(400).send("Cannot delete a plan currently assigned to universities.");
      }

      plan.isDeleted = true;
      plan.isActive = false;
      plan.updatedBy = req.user?._id || null;
      await plan.save();

      await writeAudit(req, {
        action: "Delete Plan",
        entityId: plan._id,
        description: `Soft deleted plan ${plan.name}`,
      });

      return res.redirect("/super-admin/plans");
    } catch (err) {
      console.error("❌ deletePlan error:", err);
      return res.status(500).send("Failed to delete plan.");
    }
  },
};