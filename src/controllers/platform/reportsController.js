const { platformConnection } = require("../../config/db");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformPayment = require("../../models/platform/PlatformPayment")(platformConnection);

module.exports = {
  reportsHome: async (req, res) => {
    try {
      const [
        tenantCount,
        activeCount,
        trialCount,
        suspendedCount,
        planCount,
        paymentCount,
        revenueData,
      ] = await Promise.all([
        Tenant.countDocuments({ isDeleted: { $ne: true } }),
        Tenant.countDocuments({ status: "active", isDeleted: { $ne: true } }),
        Tenant.countDocuments({ status: "trial", isDeleted: { $ne: true } }),
        Tenant.countDocuments({ status: "suspended", isDeleted: { $ne: true } }),
        Plan.countDocuments({ isDeleted: { $ne: true } }),
        PlatformPayment.countDocuments({}),
        PlatformPayment.aggregate([
          {
            $match: { status: "completed" },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount" },
            },
          },
        ]),
      ]);

      return res.render("platform/reports/index", {
        summary: {
          tenantCount,
          activeCount,
          trialCount,
          suspendedCount,
          planCount,
          paymentCount,
          totalRevenue: revenueData?.[0]?.totalRevenue || 0,
        },
        user: req.user || null,
        error: null,
      });
    } catch (err) {
      console.error("❌ reportsHome error:", err);
      return res.status(500).render("platform/reports/index", {
        summary: null,
        error: "Failed to load reports dashboard.",
      });
    }
  },

  tenantReport: async (req, res) => {
    try {
      const rows = await Tenant.find({ isDeleted: { $ne: true } })
        .populate("planId")
        .sort({ createdAt: -1 })
        .lean();

      return res.render("platform/reports/tenants", {
        rows,
        error: null,
      });
    } catch (err) {
      console.error("❌ tenantReport error:", err);
      return res.status(500).render("platform/reports/tenants", {
        rows: [],
        error: "Failed to load tenant report.",
      });
    }
  },

  planReport: async (req, res) => {
    try {
      const plans = await Plan.find({
        isDeleted: { $ne: true },
      })
        .sort({ sortOrder: 1, name: 1 })
        .lean();

      const tenantUsage = await Tenant.aggregate([
        {
          $match: {
            isDeleted: { $ne: true },
            planId: { $ne: null },
          },
        },
        {
          $group: {
            _id: "$planId",
            totalTenants: { $sum: 1 },
          },
        },
      ]);

      const usageMap = new Map(tenantUsage.map((x) => [String(x._id), x.totalTenants]));

      const rows = plans.map((plan) => ({
        ...plan,
        totalTenants: usageMap.get(String(plan._id)) || 0,
      }));

      return res.render("platform/reports/plans", {
        rows,
        error: null,
      });
    } catch (err) {
      console.error("❌ planReport error:", err);
      return res.status(500).render("platform/reports/plans", {
        rows: [],
        error: "Failed to load plan report.",
      });
    }
  },

  paymentReport: async (req, res) => {
    try {
      const rows = await PlatformPayment.find({})
        .populate("tenantId")
        .populate("planId")
        .sort({ createdAt: -1 })
        .lean();

      return res.render("platform/reports/payments", {
        rows,
        error: null,
      });
    } catch (err) {
      console.error("❌ paymentReport error:", err);
      return res.status(500).render("platform/reports/payments", {
        rows: [],
        error: "Failed to load payment report.",
      });
    }
  },
};