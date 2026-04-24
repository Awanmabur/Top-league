const { platformConnection } = require("../../config/db");

const Tenant = require("../../models/platform/Tenant")(platformConnection);
const Plan = require("../../models/platform/Plan")(platformConnection);
const PlatformPayment = require("../../models/platform/PlatformPayment")(platformConnection);
const SupportTicket = require("../../models/platform/SupportTicket")(platformConnection);
const PlatformAnnouncement = require("../../models/platform/PlatformAnnouncement")(platformConnection);
const { getPlatformAccess } = require("../../utils/platformAccess");

const DASHBOARD_META = {
  SuperAdmin: {
    title: "Platform Dashboard",
    subtitle: "Full oversight across schools, billing, support, security, and platform operations.",
  },
  Operations: {
    title: "Operations Dashboard",
    subtitle: "Stay on top of school provisioning, announcements, support load, and platform operations.",
  },
  Support: {
    title: "Support Dashboard",
    subtitle: "Focus on open tickets, current schools, and the latest platform announcements.",
  },
  Sales: {
    title: "Sales Dashboard",
    subtitle: "Track active schools, plans, growth signals, and the schools pipeline.",
  },
  Finance: {
    title: "Finance Dashboard",
    subtitle: "Monitor revenue, subscriptions, payments, and platform billing health.",
  },
};

function buildFocusCards(access, stats = {}) {
  const cardsByRole = {
    SuperAdmin: [
      {
        label: "Active Schools",
        value: stats.activeTenants || 0,
        note: `${stats.trialTenants || 0} trial and ${stats.suspendedTenants || 0} suspended`,
      },
      {
        label: "Plans",
        value: stats.planCount || 0,
        note: "Currently active platform plans",
      },
      {
        label: "Open Support Tickets",
        value: stats.openTickets || 0,
        note: "Tickets marked open or pending",
      },
      {
        label: "Revenue",
        value: `$${Number(stats.totalRevenue || 0).toLocaleString()}`,
        note: `${stats.publishedAnnouncements || 0} published announcements`,
      },
    ],
    Operations: [
      {
        label: "Active Schools",
        value: stats.activeTenants || 0,
        note: `${stats.tenantCount || 0} total schools on platform`,
      },
      {
        label: "Trial Schools",
        value: stats.trialTenants || 0,
        note: "New onboarding work to monitor",
      },
      {
        label: "Open Support Tickets",
        value: stats.openTickets || 0,
        note: "Current operational support load",
      },
      {
        label: "Published Announcements",
        value: stats.publishedAnnouncements || 0,
        note: "Platform-wide notices currently live",
      },
    ],
    Support: [
      {
        label: "Open Support Tickets",
        value: stats.openTickets || 0,
        note: "Open and pending issues that need follow-up",
      },
      {
        label: "Active Schools",
        value: stats.activeTenants || 0,
        note: `${stats.tenantCount || 0} total schools you can support`,
      },
      {
        label: "Published Announcements",
        value: stats.publishedAnnouncements || 0,
        note: "Current platform communication visible to schools",
      },
      {
        label: "Trial Schools",
        value: stats.trialTenants || 0,
        note: "Schools that may need setup help",
      },
    ],
    Sales: [
      {
        label: "Total Schools",
        value: stats.tenantCount || 0,
        note: `${stats.activeTenants || 0} active schools on paid or live plans`,
      },
      {
        label: "Trial Schools",
        value: stats.trialTenants || 0,
        note: "Current pipeline to convert",
      },
      {
        label: "Plans",
        value: stats.planCount || 0,
        note: "Available pricing and package options",
      },
      {
        label: "Suspended Schools",
        value: stats.suspendedTenants || 0,
        note: "Accounts to review for recovery or follow-up",
      },
    ],
    Finance: [
      {
        label: "Revenue",
        value: `$${Number(stats.totalRevenue || 0).toLocaleString()}`,
        note: "Completed platform payments on record",
      },
      {
        label: "Active Schools",
        value: stats.activeTenants || 0,
        note: "Current live billing footprint",
      },
      {
        label: "Plans",
        value: stats.planCount || 0,
        note: "Plan catalog currently in use",
      },
      {
        label: "Trial Schools",
        value: stats.trialTenants || 0,
        note: "Upcoming schools likely to enter billing",
      },
    ],
  };

  return cardsByRole[access.role] || cardsByRole.Support;
}

function buildModules(access, stats = {}) {
  const items = [
    {
      permission: "schools.view",
      title: "Schools",
      description: "Manage tenant status, onboarding, school units, and provisioning details.",
      href: "/super-admin/schools",
      icon: "fa-building-columns",
      meta: `${stats.tenantCount || 0} total`,
    },
    {
      permission: "plans.view",
      title: "Plans",
      description: "Review package configuration, pricing structure, and plan availability.",
      href: "/super-admin/plans",
      icon: "fa-layer-group",
      meta: `${stats.planCount || 0} active plans`,
    },
    {
      permission: "billing.view",
      title: "Billing",
      description: "Track completed platform payments, renewals, and subscription health.",
      href: "/super-admin/billing-subscriptions",
      icon: "fa-credit-card",
      meta: `$${Number(stats.totalRevenue || 0).toLocaleString()}`,
    },
    {
      permission: "announcements.view",
      title: "Announcements",
      description: "Review or publish platform-wide communication to tenant schools.",
      href: "/super-admin/announcements",
      icon: "fa-bullhorn",
      meta: `${stats.publishedAnnouncements || 0} published`,
    },
    {
      permission: "reports.view",
      title: "Reports",
      description: "Compare tenants, plans, payments, and usage trends across the platform.",
      href: "/super-admin/reports",
      icon: "fa-chart-line",
      meta: "Cross-platform insights",
    },
    {
      permission: "support.view",
      title: "Support",
      description: "Work through support tickets, assignment, replies, and status updates.",
      href: "/super-admin/support-tickets",
      icon: "fa-headset",
      meta: `${stats.openTickets || 0} open or pending`,
    },
    {
      permission: "settings.view",
      title: "Settings",
      description: "Update platform-wide defaults, branding, and security preferences.",
      href: "/super-admin/settings",
      icon: "fa-gear",
      meta: "Platform configuration",
    },
    {
      permission: "audit.view",
      title: "Audit Logs",
      description: "Review platform actions, access history, and sensitive operational changes.",
      href: "/super-admin/audit-logs",
      icon: "fa-shield-halved",
      meta: "Security visibility",
    },
  ];

  return items.filter((item) => access.can(item.permission));
}

function buildShortcuts(access) {
  const items = [
    {
      permission: "schools.manage",
      href: "/super-admin/schools/create",
      label: "Add School",
      icon: "fa-building-circle-plus",
    },
    {
      permission: "billing.manage",
      href: "/super-admin/billing/payments/create",
      label: "Record Payment",
      icon: "fa-receipt",
    },
    {
      permission: "announcements.manage",
      href: "/super-admin/announcements/create",
      label: "New Announcement",
      icon: "fa-bullhorn",
    },
    {
      permission: "support.manage",
      href: "/super-admin/support-tickets/create",
      label: "Open Ticket",
      icon: "fa-headset",
    },
    {
      permission: "settings.manage",
      href: "/super-admin/settings",
      label: "Platform Settings",
      icon: "fa-gear",
    },
  ];

  return items.filter((item) => access.can(item.permission));
}

module.exports = {
  dashboardPage: async (req, res) => {
    try {
      const access = req.platformAccess || getPlatformAccess(req.user?.role);
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
      const stats = {
        tenantCount: tenantStats.total || 0,
        activeTenants: tenantStats.active || 0,
        trialTenants: tenantStats.trial || 0,
        suspendedTenants: tenantStats.suspended || 0,
        planCount,
        openTickets,
        publishedAnnouncements,
        totalRevenue: recentPaymentsAgg?.[0]?.totalRevenue || 0,
      };

      return res.render("platform/dashboard/index", {
        stats,
        user: req.user || null,
        dashboardMeta: DASHBOARD_META[access.role] || DASHBOARD_META.Support,
        focusCards: buildFocusCards(access, stats),
        modules: buildModules(access, stats),
        shortcuts: buildShortcuts(access),
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
        dashboardMeta: DASHBOARD_META[req.user?.role] || DASHBOARD_META.Support,
        focusCards: buildFocusCards(
          req.platformAccess || getPlatformAccess(req.user?.role),
          {
            tenantCount: 0,
            activeTenants: 0,
            trialTenants: 0,
            suspendedTenants: 0,
            planCount: 0,
            openTickets: 0,
            publishedAnnouncements: 0,
            totalRevenue: 0,
          },
        ),
        modules: [],
        shortcuts: [],
        recentTenants: [],
        error: "Failed to load dashboard.",
      });
    }
  },
};
