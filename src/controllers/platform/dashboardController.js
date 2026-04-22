const { platformConnection } = require("../../config/db");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformPayment = require("../../models/platform/PlatformPayment")(platformConnection);
const SupportTicket = require("../../models/platform/SupportTicket")(platformConnection);
const PlatformAnnouncement = require("../../models/platform/PlatformAnnouncement")(platformConnection);

module.exports = {
  dashboardPage: async (req, res) => {
    try {
      const [
        tenantStatsAgg,
        planCount,
        openTickets,
        publishedAnnouncements,
        recentTenants,
        recentPaymentsAgg,
      ] = await Promise.all([
        Tenant.aggregate([
          { $match: { isDeleted: { $ne: true } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
              trial: { $sum: { $cond: [{ $eq: ["$status", "trial"] }, 1, 0] } },
              suspended: { $sum: { $cond: [{ $eq: ["$status", "suspended"] }, 1, 0] } },
            },
          },
        ]),
        Plan.countDocuments({ isDeleted: { $ne: true }, isActive: true }),
        SupportTicket.countDocuments({ status: { $in: ["open", "pending"] } }),
        PlatformAnnouncement.countDocuments({ status: "published" }),
        Tenant.find({ isDeleted: { $ne: true } })
          .select("name code status planId createdAt")
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("planId", "name code")
          .lean(),
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

      const tenantStats = tenantStatsAgg[0] || {};

      return res.render("platform/dashboard/index", {
        stats: {
          tenantCount: tenantStats.total || 0,
          activeTenants: tenantStats.active || 0,
          trialTenants: tenantStats.trial || 0,
          suspendedTenants: tenantStats.suspended || 0,
          planCount,
          openTickets,
          publishedAnnouncements,
          totalRevenue: recentPaymentsAgg?.[0]?.totalRevenue || 0,
        },
        user: req.user || null,
        recentTenants,
        error: null,
      });
    } catch (err) {
      console.error("dashboardPage error:", err.message || err);
      return res.status(500).render("platform/dashboard/index", {
        stats: {
          tenantCount: 0,
          activeTenants: 0,
          trialTenants: 0,
          suspendedTenants: 0,
          planCount: 0,
          openTickets: 0,
          publishedAnnouncements: 0,
          totalRevenue: 0,
        },
        recentTenants: [],
        error: "Failed to load dashboard.",
      });
    }
  },
};
