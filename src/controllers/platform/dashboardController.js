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
        tenantCount,
        activeTenants,
        trialTenants,
        suspendedTenants,
        planCount,
        openTickets,
        publishedAnnouncements,
        recentTenants,
        recentPaymentsAgg,
      ] = await Promise.all([
        Tenant.countDocuments({ isDeleted: { $ne: true } }),
        Tenant.countDocuments({ status: "active", isDeleted: { $ne: true } }),
        Tenant.countDocuments({ status: "trial", isDeleted: { $ne: true } }),
        Tenant.countDocuments({ status: "suspended", isDeleted: { $ne: true } }),
        Plan.countDocuments({ isDeleted: { $ne: true }, isActive: true }),
        SupportTicket.countDocuments({ status: { $in: ["open", "pending"] } }),
        PlatformAnnouncement.countDocuments({ status: "published" }),
        Tenant.find({ isDeleted: { $ne: true } })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("planId")
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

      return res.render("platform/dashboard/index", {
        stats: {
          tenantCount,
          activeTenants,
          trialTenants,
          suspendedTenants,
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
      console.error("❌ dashboardPage error:", err);
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