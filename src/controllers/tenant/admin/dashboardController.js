// src/controllers/tenant/dashboard.controller.js

const { getSchoolUi } = require("../../../utils/school-ui");
const { getPrimaryTenantRole, getTenantRoleAccess } = require("../../../utils/tenantRoles");

module.exports = {
  dashboard: async (req, res) => {
    try {
      const tenant = req.tenant;
      const user = req.user;
      const models = req.models || {};
      const role = getPrimaryTenantRole(user?.role || user?.roles || "");

      const tenantAccess = res.locals.tenantAccess || {};
      const roleAccess = res.locals.roleAccess || getTenantRoleAccess(role);
      const schoolLevel = tenantAccess.schoolLevel || "high";
      const ui = getSchoolUi(schoolLevel);
      const availableModels = new Set(Object.keys(models).filter((key) => models[key]));

      const {
        Student,
        Applicant,
        Invoice,
        Payment,
        Announcement,
        Notification,
        User,
        AuditLog,
        SystemHealth,
      } = models;

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const safeCount = async (Model, filter = {}) => {
        if (!Model) return 0;
        return Model.countDocuments(filter);
      };

      const safeFind = async (Model, filter = {}, projection = null, options = {}) => {
        if (!Model) return [];
        let query = Model.find(filter, projection);

        if (options.sort) query = query.sort(options.sort);
        if (options.limit) query = query.limit(options.limit);
        if (options.populate) {
          for (const pop of options.populate) query = query.populate(pop);
        }

        return query.lean();
      };

      const safeAggregate = async (Model, pipeline = []) => {
        if (!Model) return [];
        return Model.aggregate(pipeline);
      };

      // KPIs
      const activeStudentFilter = { isDeleted: { $ne: true } };
      const activeInvoiceFilter = { isDeleted: { $ne: true } };
      const activePaymentFilter = { isDeleted: { $ne: true } };
      const pendingApplicantStatuses = ["submitted", "under_review"];
      const acceptedApplicantStatuses = ["accepted", "converted"];
      const unpaidInvoiceStatuses = ["Unpaid", "Partially Paid", "Overdue"];
      const dashboardApplicantStatuses = Array.from(
        new Set([...pendingApplicantStatuses, ...acceptedApplicantStatuses]),
      );

      const [
        studentKpiAgg,
        applicantKpiAgg,
        outstandingFeesAgg,
        studentsOwingAgg,
        activeUsers,
        notificationsCount,
      ] = await Promise.all([
        safeAggregate(Student, [
          {
            $match: activeStudentFilter,
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              newThisMonth: {
                $sum: {
                  $cond: [{ $gte: ["$createdAt", startOfMonth] }, 1, 0],
                },
              },
            },
          },
        ]),
        safeAggregate(Applicant, [
          {
            $match: {
              isDeleted: { $ne: true },
              status: { $in: dashboardApplicantStatuses },
            },
          },
          {
            $group: {
              _id: null,
              pending: {
                $sum: {
                  $cond: [{ $in: ["$status", pendingApplicantStatuses] }, 1, 0],
                },
              },
              submittedThisMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$status", "submitted"] },
                        { $gte: ["$createdAt", startOfMonth] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              inReviewThisMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$status", "under_review"] },
                        { $gte: ["$createdAt", startOfMonth] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              acceptedThisMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $in: ["$status", acceptedApplicantStatuses] },
                        { $gte: ["$createdAt", startOfMonth] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
        safeAggregate(Invoice, [
        {
          $match: {
            ...activeInvoiceFilter,
            status: { $in: unpaidInvoiceStatuses },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$balance" },
          },
        },
        ]),
        safeAggregate(Invoice, [
          {
            $match: {
              ...activeInvoiceFilter,
              status: { $in: unpaidInvoiceStatuses },
              balance: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: "$studentId",
            },
          },
          { $count: "total" },
        ]),
        safeCount(User, { status: "active", deletedAt: null }),
        safeCount(Notification, {
          isDeleted: { $ne: true },
          isRead: { $ne: true },
          audience: { $in: ["admin", "all"] },
        }),
      ]);

      const studentKpis = studentKpiAgg[0] || {};
      const applicantKpis = applicantKpiAgg[0] || {};
      const totalStudents = studentKpis.total || 0;
      const newStudentsThisMonth = studentKpis.newThisMonth || 0;
      const pendingApps = applicantKpis.pending || 0;
      const submittedApps = applicantKpis.submittedThisMonth || 0;
      const inReviewApps = applicantKpis.inReviewThisMonth || 0;
      const acceptedApps = applicantKpis.acceptedThisMonth || 0;
      const outstandingFees = outstandingFeesAgg[0]?.total || 0;
      const studentsOwing = studentsOwingAgg[0]?.total || 0;

      const [
        avgReviewTime,
        countriesAgg,
        classAgg,
        auditLogs,
        announcementRows,
        recentStudentRows,
        pendingApplicationRows,
        financeAggs,
        systemSnapshot,
      ] = await Promise.all([
        computeAverageReviewTime(Applicant, startOfMonth),
        safeAggregate(Applicant, [
          {
            $match: {
              isDeleted: { $ne: true },
              createdAt: { $gte: thirtyDaysAgo },
              nationality: { $exists: true, $nin: [null, ""] },
            },
          },
          {
            $group: {
              _id: "$nationality",
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ]),
        safeAggregate(Student, [
          {
            $match: {
              isDeleted: { $ne: true },
              classLevel: { $exists: true, $ne: null, $ne: "" },
            },
          },
          {
            $group: {
              _id: "$classLevel",
              val: { $sum: 1 },
            },
          },
          { $sort: { val: -1 } },
          { $limit: 6 },
        ]),
        safeFind(
          AuditLog,
          { isDeleted: { $ne: true } },
          "action actorName actorEmail module entityLabel createdAt",
          {
            sort: { createdAt: -1 },
            limit: 10,
          },
        ),
        safeFind(
          Announcement,
          { isDeleted: { $ne: true } },
          "title status createdAt",
          {
            sort: { createdAt: -1 },
            limit: 4,
          },
        ),
        Student
          ? Student.find({ isDeleted: { $ne: true } })
              .select("fullName name firstName lastName classLevel section stream className status financeBalance")
              .sort({ createdAt: -1 })
              .limit(5)
              .lean()
          : Promise.resolve([]),
        Applicant
          ? Applicant.find({
              isDeleted: { $ne: true },
              status: { $in: pendingApplicantStatuses },
            })
              .select("fullName name firstName lastName nationality section1 program1")
              .sort({ createdAt: -1 })
              .limit(5)
              .populate("section1", "code name classLevel classStream")
              .populate("program1", "code name classLevel classStream")
              .lean()
          : Promise.resolve([]),
        safeAggregate(Payment, [
          {
            $match: {
              ...activePaymentFilter,
              status: { $in: ["Completed", "Refunded"] },
              paymentDate: {
                $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1),
              },
            },
          },
          {
            $facet: {
              collected: [
                { $match: { status: "Completed", paymentDate: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: "$amount" } } },
              ],
              refunds: [
                { $match: { status: "Refunded", paymentDate: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: "$amount" } } },
              ],
              offline: [
                {
                  $match: {
                    status: "Completed",
                    paymentDate: { $gte: startOfMonth },
                    method: { $in: ["Cash", "Bank", "Cheque", "Transfer"] },
                  },
                },
                { $group: { _id: null, total: { $sum: "$amount" } } },
              ],
              monthlyRevenue: [
                { $match: { status: "Completed" } },
                {
                  $group: {
                    _id: {
                      month: { $month: "$paymentDate" },
                      year: { $year: "$paymentDate" },
                    },
                    total: { $sum: "$amount" },
                  },
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
              ],
            },
          },
        ]),
        loadSystemHealthSnapshot(SystemHealth),
      ]);

      // Admissions snapshot
      const admissionsTotal =
        submittedApps + inReviewApps + acceptedApps || Math.max(pendingApps, 1);

      const submittedPct = admissionsTotal ? Math.round((submittedApps / admissionsTotal) * 100) : 0;
      const verifiedPct = admissionsTotal ? Math.round((inReviewApps / admissionsTotal) * 100) : 0;
      const acceptedPct = admissionsTotal ? Math.round((acceptedApps / admissionsTotal) * 100) : 0;

      const totalCountryCount = countriesAgg.reduce((sum, item) => sum + item.count, 0) || 1;
      const countryColors = ["#0a6fbf", "#60a5fa", "#7dd3fc", "#a78bfa", "#fb7185"];

      const countries = countriesAgg.map((item, index) => ({
        country: item._id,
        val: Math.round((item.count / totalCountryCount) * 100),
        color: countryColors[index] || "#94a3b8",
      }));

      const portalUptime = systemSnapshot.portalUptime;

      // Distribution data
      const departments = classAgg.map((d) => ({
        name: d._id || "Unknown",
        val: d.val,
      }));

      // Recent activity
      let recentActivity = auditLogs.map((log) => ({
        text: [
          log.action || "Activity recorded",
          log.module ? `in ${log.module}` : "",
          log.entityLabel ? `(${log.entityLabel})` : "",
        ].filter(Boolean).join(" "),
        time: formatTimeAgo(log.createdAt),
      }));

      if (!recentActivity.length) {
        recentActivity = [
          { text: `${submittedApps} new applications submitted`, time: "This month" },
          { text: `${newStudentsThisMonth} new students enrolled`, time: "This month" },
          { text: `${studentsOwing} students have pending balances`, time: "Live" },
          { text: `${activeUsers} active users on the portal`, time: "Live" },
        ];
      }

      // Announcements
      const announcements = announcementRows.map((a) => ({
        title: a.title || "Untitled Announcement",
        status: capitalize(a.status || "Draft"),
      }));

      // Recent students
      const recentStudents = recentStudentRows.map((s) => ({
        name:
          s.fullName ||
          s.name ||
          `${s.firstName || ""} ${s.lastName || ""}`.trim() ||
          "Student",
        group: [s.classLevel, s.section || s.stream].filter(Boolean).join(" ") || s.className || "-",
        status: capitalize(String(s.status || "active").replace(/_/g, " ")),
        balance: formatMoney(s.financeBalance || 0, tenant?.currency || "USD"),
      }));

      // Pending applications table
      const pendingApplicationsTable = pendingApplicationRows.map((a) => ({
        id: a._id,
        name:
          a.fullName ||
          a.name ||
          `${a.firstName || ""} ${a.lastName || ""}`.trim() ||
          "Applicant",
        group: a.section1
          ? ((a.section1.code ? `${a.section1.code} - ` : "") + (a.section1.name || a.section1.className || "Section"))
          : (a.program1 ? ((a.program1.code ? `${a.program1.code} - ` : "") + (a.program1.name || a.program1.className || "Section")) : "-"),
        country: a.nationality || "-",
      }));

      // Finance snapshot
      const financeFacet = financeAggs[0] || {};
      const collectedAgg = financeFacet.collected || [];
      const refundsAgg = financeFacet.refunds || [];
      const offlineAgg = financeFacet.offline || [];
      const monthlyRevenueAgg = financeFacet.monthlyRevenue || [];

      const finance = {
        collected: collectedAgg[0]?.total || 0,
        pending: outstandingFees,
        refunds: refundsAgg[0]?.total || 0,
        offlinePayments: offlineAgg[0]?.total || 0,
      };

      // Revenue trend

      const revenue = buildMonthlySeries(monthlyRevenueAgg, now);
      const systemStatus = systemSnapshot.systemStatus;

      const dashboardData = {
        studentsTrend: buildSoftTrend(totalStudents, newStudentsThisMonth, 15),
        appsTrend: buildSoftTrend(pendingApps, submittedApps, 15),
        feesTrend: buildSoftTrend(outstandingFees, studentsOwing, 15),
        uptimeTrend: buildFlatTrend(portalUptime, 15),
        notificationsCount,
        countries,
        departments,
        recentStudents,
        pendingApps: pendingApplicationsTable,
        revenue,
        recentActivity,
        announcements,
        systemStatus,
        admissions: {
          submitted: submittedApps,
          verified: inReviewApps,
          accepted: acceptedApps,
          submittedPct,
          verifiedPct,
          acceptedPct,
        },
      };

      const stats = {
        totalStudents,
        newStudentsThisMonth,
        pendingApps,
        avgReviewTime,
        outstandingFees,
        studentsOwing,
        portalUptime,
        activeUsers,
        finance,
      };

      const roleWorkspace = ["finance", "librarian", "hostel"].includes(role)
        ? await buildRoleWorkspace({
            role,
            models,
            stats,
            dashboardData,
            tenant,
          })
        : null;
      const focusCards = buildTenantFocusCards({
        role,
        tenant,
        stats,
        dashboardData,
        roleWorkspace,
      });
      const dashboardModules = buildTenantDashboardModules({
        roleAccess,
        tenantAccess,
        availableModels,
        stats,
        dashboardData,
        tenant,
      });
      const dashboardShortcuts = buildTenantDashboardShortcuts({
        roleAccess,
        availableModels,
        tenantAccess,
        roleWorkspace,
        dashboardModules,
      });

      res.render("tenant/dashboard/index", {
        tenant,
        user,
        stats,
        dashboardData,
        ui,
        focusCards,
        dashboardModules,
        dashboardShortcuts,
        roleWorkspace,
      });
    } catch (error) {
      console.error("Dashboard controller error:", error);

      const tenantAccess = res.locals.tenantAccess || {};
      const schoolLevel = tenantAccess.schoolLevel || "high";
      const ui = getSchoolUi(schoolLevel);
      const role = getPrimaryTenantRole(req.user?.role || req.user?.roles || "");
      const roleAccess = res.locals.roleAccess || getTenantRoleAccess(role);
      const availableModels = new Set(Object.keys(req.models || {}).filter((key) => req.models?.[key]));
      const stats = {
        totalStudents: 0,
        newStudentsThisMonth: 0,
        pendingApps: 0,
        avgReviewTime: "0 hrs",
        outstandingFees: 0,
        studentsOwing: 0,
        portalUptime: 0,
        activeUsers: 0,
        finance: {
          collected: 0,
          pending: 0,
          refunds: 0,
          offlinePayments: 0,
        },
      };
      const dashboardData = {
        studentsTrend: [],
        appsTrend: [],
        feesTrend: [],
        uptimeTrend: [],
        countries: [],
        departments: [],
        recentStudents: [],
        pendingApps: [],
        revenue: [],
        recentActivity: [],
        announcements: [],
        notificationsCount: 0,
        systemStatus: {
          uptime: 0,
          errors24h: 0,
          dbLag: "0s",
          storage: 0,
        },
        admissions: {
          submitted: 0,
          verified: 0,
          accepted: 0,
          submittedPct: 0,
          verifiedPct: 0,
          acceptedPct: 0,
        },
      };
      const roleWorkspace = ["finance", "librarian", "hostel"].includes(role)
        ? {
            title: "Workspace",
            subtitle: "Your role-specific workspace could not be loaded.",
            cards: [],
            shortcuts: [],
            announcements: [],
          }
        : null;
      const dashboardModules = buildTenantDashboardModules({
        roleAccess,
        tenantAccess,
        availableModels,
        stats,
        dashboardData,
        tenant: req.tenant,
      });
      const dashboardShortcuts = buildTenantDashboardShortcuts({
        roleAccess,
        availableModels,
        tenantAccess,
        roleWorkspace,
        dashboardModules,
      });

      res.status(500).render("tenant/dashboard/index", {
        tenant: req.tenant,
        user: req.user,
        ui,
        stats,
        dashboardData,
        focusCards: buildTenantFocusCards({
          role,
          tenant: req.tenant,
          stats,
          dashboardData,
          roleWorkspace,
        }),
        dashboardModules,
        dashboardShortcuts,
        roleWorkspace,
      });
    }
  },
};

function capitalize(value = "") {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMoney(amount = 0, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  } catch (e) {
    return `$${Number(amount || 0).toLocaleString()}`;
  }
}

function formatTimeAgo(date) {
  if (!date) return "Recently";

  const diffMs = Date.now() - new Date(date).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hrs ago`;
  if (diffDay < 7) return `${diffDay} days ago`;

  return new Date(date).toLocaleDateString();
}

function parsePercent(value, fallback = 0) {
  const num = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(num) ? num : fallback;
}

async function computeAverageReviewTime(Applicant, startOfMonth) {
  if (!Applicant) return "N/A";

  const rows = await Applicant.aggregate([
    {
      $match: {
        isDeleted: { $ne: true },
        decidedAt: { $ne: null, $gte: startOfMonth },
        createdAt: { $ne: null },
      },
    },
    {
      $project: {
        hours: {
          $divide: [{ $subtract: ["$decidedAt", "$createdAt"] }, 1000 * 60 * 60],
        },
      },
    },
    {
      $group: {
        _id: null,
        avg: { $avg: "$hours" },
      },
    },
  ]);

  const hours = rows[0]?.avg;
  if (!Number.isFinite(hours)) return "N/A";
  if (hours < 24) return `${Math.max(1, Math.round(hours))} hrs`;
  return `${Math.round(hours / 24)} days`;
}

async function loadSystemHealthSnapshot(SystemHealth) {
  const fallback = {
    portalUptime: 100,
    systemStatus: { uptime: 100, errors24h: 0, dbLag: "0s", storage: 0 },
  };

  if (!SystemHealth) return fallback;

  const services = await SystemHealth.find({ isDeleted: { $ne: true } })
    .select("type status metrics lastCheckedAt updatedAt incidents")
    .lean();

  const values = services
    .map((row) => parsePercent(row.metrics?.uptime, NaN))
    .filter((value) => Number.isFinite(value));

  const portalUptime = values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : 100;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const errors24h = services.filter((service) => {
    const changedAt = service.lastCheckedAt || service.updatedAt;
    return ["Critical", "Warning"].includes(service.status) && changedAt && new Date(changedAt) >= since;
  }).length;

  const storage = services.find((service) => service.type === "Storage");
  const storageValue = storage
    ? parsePercent(storage.metrics?.memory || storage.metrics?.load || storage.metrics?.uptime, 0)
    : 0;

  return {
    portalUptime,
    systemStatus: {
      uptime: portalUptime,
      errors24h,
      dbLag: "0s",
      storage: storageValue,
    },
  };
}

function buildSoftTrend(primaryValue = 0, secondaryValue = 0, length = 15) {
  const base = Number(primaryValue || 0);
  const delta = Number(secondaryValue || 0);
  const start = Math.max(1, Math.round(base - delta));
  const step = Math.max(1, Math.round((base - start) / Math.max(1, length - 1)));

  return Array.from({ length }, (_, i) => start + step * i);
}

function buildFlatTrend(value = 0, length = 15) {
  const base = Number(value || 0);
  return Array.from({ length }, () => base);
}

function buildMonthlySeries(agg = [], now = new Date()) {
  const map = {};

  agg.forEach((item) => {
    const key = `${item._id.year}-${item._id.month}`;
    map[key] = item.total || 0;
  });

  const series = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    series.push(map[key] || 0);
  }

  return series;
}

async function safeCount(Model, filter = {}) {
  if (!Model) return 0;
  return Model.countDocuments(filter).catch(() => 0);
}

async function safeRecentAnnouncements(Announcement) {
  if (!Announcement) return [];
  return Announcement.find({ isDeleted: { $ne: true } })
    .select("title status createdAt")
    .sort({ createdAt: -1 })
    .limit(5)
    .lean()
    .catch(() => []);
}

function buildTenantFocusCards({ role, tenant, stats, dashboardData, roleWorkspace }) {
  if (roleWorkspace?.cards?.length) {
    return roleWorkspace.cards.map((card) => ({
      label: card.label,
      value: card.value,
      note: card.note,
    }));
  }

  if (role === "registrar") {
    return [
      {
        label: "Pending Applications",
        value: (stats?.pendingApps || 0).toLocaleString(),
        note: `Average review time: ${stats?.avgReviewTime || "N/A"}`,
      },
      {
        label: "Students",
        value: (stats?.totalStudents || 0).toLocaleString(),
        note: `+${(stats?.newStudentsThisMonth || 0).toLocaleString()} new this month`,
      },
      {
        label: "Admissions Reviewed",
        value: ((dashboardData?.admissions?.verified || 0) + (dashboardData?.admissions?.accepted || 0)).toLocaleString(),
        note: `${dashboardData?.admissions?.submitted || 0} submitted this month`,
      },
      {
        label: "Unread Notifications",
        value: (dashboardData?.notificationsCount || 0).toLocaleString(),
        note: `${(dashboardData?.announcements || []).length} announcement items`,
      },
    ];
  }

  return [
    {
      label: "Students",
      value: (stats?.totalStudents || 0).toLocaleString(),
      note: `+${(stats?.newStudentsThisMonth || 0).toLocaleString()} new this month`,
    },
    {
      label: "Pending Applications",
      value: (stats?.pendingApps || 0).toLocaleString(),
      note: `Average review time: ${stats?.avgReviewTime || "N/A"}`,
    },
    {
      label: "Outstanding Fees",
      value: formatMoney(stats?.outstandingFees || 0, tenant?.currency || "USD"),
      note: `${(stats?.studentsOwing || 0).toLocaleString()} learners owing`,
    },
    {
      label: "Portal Health",
      value: `${Number(stats?.portalUptime || 0)}%`,
      note: `${(stats?.activeUsers || 0).toLocaleString()} active users`,
    },
  ];
}

function buildTenantDashboardModules({
  roleAccess,
  tenantAccess,
  availableModels,
  stats,
  dashboardData,
  tenant,
}) {
  const hasAnyModel = (...names) => names.some((name) => availableModels.has(name));
  const hasFeature = (name) => tenantAccess?.featureFlags?.[name] !== false;
  const schoolLevel = tenantAccess?.schoolLevel || "high";

  const items = [
    {
      permission: "admissions.view",
      title: "Admissions",
      href: "/admin/admissions",
      icon: "fa-user-plus",
      meta: `${(stats?.pendingApps || 0).toLocaleString()} pending`,
      available: hasAnyModel("Applicant"),
    },
    {
      permission: "students.view",
      title: "Students",
      href: "/admin/students",
      icon: "fa-user-graduate",
      meta: `${(stats?.totalStudents || 0).toLocaleString()} enrolled`,
      available: hasAnyModel("Student"),
    },
    {
      permission: "parents.view",
      title: "Parents",
      href: "/admin/parents",
      icon: "fa-people-roof",
      meta: "Parent records",
      available: hasAnyModel("Parent"),
    },
    {
      permission: "subjects.view",
      title: "Subjects",
      href: "/admin/subjects",
      icon: "fa-book-open",
      meta: "Curriculum setup",
      available: hasAnyModel("Subject"),
    },
    {
      permission: "classes.view",
      title: "Classes",
      href: "/admin/classes",
      icon: "fa-chalkboard",
      meta: schoolLevel === "high" ? "Class structures" : "Learning groups",
      available: hasAnyModel("Class"),
    },
    {
      permission: "sections.view",
      title: "Sections",
      href: "/admin/sections",
      icon: "fa-layer-group",
      meta: "Streams and sections",
      available: hasAnyModel("Section"),
    },
    {
      permission: "timetable.view",
      title: "Timetable",
      href: "/admin/timetable",
      icon: "fa-calendar-week",
      meta: "Schedules and periods",
      available: hasAnyModel("TimetableEntry"),
    },
    {
      permission: "attendance.view",
      title: "Attendance",
      href: "/admin/attendance",
      icon: "fa-user-check",
      meta: "Daily attendance tracking",
      available: hasAnyModel("Attendance"),
    },
    {
      permission: "results.view",
      title: "Results",
      href: "/admin/results",
      icon: "fa-square-poll-vertical",
      meta: "Assessments and grades",
      available: hasAnyModel("Result"),
    },
    {
      permission: "transcripts.view",
      title: "Transcripts",
      href: "/admin/transcripts",
      icon: "fa-file-lines",
      meta: "Official records",
      available: hasAnyModel("Transcript"),
    },
    {
      permission: "finance.view",
      title: "Finance",
      href: "/admin/finance",
      icon: "fa-sack-dollar",
      meta: formatMoney(stats?.finance?.collected || 0, tenant?.currency || "USD"),
      available: hasAnyModel("Invoice", "Payment", "FeeStructure"),
    },
    {
      permission: "finance.view",
      title: "Invoices",
      href: "/admin/invoices",
      icon: "fa-file-invoice-dollar",
      meta: `${(stats?.studentsOwing || 0).toLocaleString()} owing`,
      available: hasAnyModel("Invoice"),
    },
    {
      permission: "finance.view",
      title: "Payments",
      href: "/admin/payments",
      icon: "fa-money-bill-wave",
      meta: "Collections log",
      available: hasAnyModel("Payment"),
    },
    {
      permission: "library.view",
      title: "Library",
      href: "/admin/library",
      icon: "fa-book",
      meta: "Books and loans",
      available: hasAnyModel("LibraryBook"),
    },
    {
      permission: "hostels.view",
      title: "Hostels",
      href: "/admin/hostels",
      icon: "fa-bed",
      meta: "Rooms and allocations",
      available: hasAnyModel("Hostel"),
    },
    {
      permission: "messaging.view",
      title: "Messaging",
      href: "/admin/messaging",
      icon: "fa-comments",
      meta: "Direct communication",
      available: hasAnyModel("Message", "Notification"),
    },
    {
      permission: "inquiries.view",
      title: "Inquiries",
      href: "/admin/inquiries",
      icon: "fa-envelope-open-text",
      meta: "Public contact submissions",
      available: true,
    },
    {
      permission: "announcements.view",
      title: "Announcements",
      href: "/admin/announcements",
      icon: "fa-bullhorn",
      meta: `${(dashboardData?.announcements || []).length} updates`,
      available: hasAnyModel("Announcement"),
    },
    {
      permission: "notifications.view",
      title: "Notifications",
      href: "/admin/notifications",
      icon: "fa-bell",
      meta: `${(dashboardData?.notificationsCount || 0).toLocaleString()} unread`,
      available: hasAnyModel("Notification"),
    },
    {
      permission: "reports.view",
      title: "Reports",
      href: "/admin/reports",
      icon: "fa-chart-line",
      meta: "Exports and summaries",
      available: hasAnyModel("ReportExport"),
    },
    {
      permission: "profile.view",
      title: "Profile",
      href: "/admin/profile",
      icon: "fa-id-badge",
      meta: "School profile and public page",
      available: true,
    },
    {
      permission: "staff.view",
      title: "Staff",
      href: "/admin/staff",
      icon: "fa-chalkboard-user",
      meta: "Staff records",
      available: hasAnyModel("Staff"),
    },
    {
      permission: "users.view",
      title: "Users",
      href: "/admin/users",
      icon: "fa-users-gear",
      meta: "Portal accounts",
      available: hasAnyModel("User"),
    },
    {
      permission: "roles.view",
      title: "Roles",
      href: "/admin/roles",
      icon: "fa-user-shield",
      meta: "Staff roles and permissions",
      available: hasAnyModel("StaffRole"),
    },
    {
      permission: "payroll.view",
      title: "Payroll",
      href: "/admin/payroll",
      icon: "fa-wallet",
      meta: "Payroll runs",
      available: hasAnyModel("PayrollRun", "PayrollItem", "LeaveRequest"),
    },
    {
      permission: "transport.view",
      title: "Transport",
      href: "/admin/transport",
      icon: "fa-bus",
      meta: "Routes and buses",
      available: hasAnyModel("Transport"),
    },
    {
      permission: "assets.view",
      title: "Assets",
      href: "/admin/assets",
      icon: "fa-boxes-stacked",
      meta: "Inventory and equipment",
      available: hasAnyModel("Asset"),
    },
    {
      permission: "events.view",
      title: "Events",
      href: "/admin/events",
      icon: "fa-calendar-days",
      meta: "School events",
      available: hasAnyModel("Event"),
    },
    {
      permission: "helpdesk.view",
      title: "Helpdesk",
      href: "/admin/helpdesk",
      icon: "fa-headset",
      meta: "Support tickets",
      available: hasFeature("helpdesk"),
    },
    {
      permission: "audit.view",
      title: "Audit Logs",
      href: "/admin/auditlogs",
      icon: "fa-shield-halved",
      meta: "Security and admin activity",
      available: hasAnyModel("AuditLog"),
    },
    {
      permission: "system.view",
      title: "System",
      href: "/admin/system",
      icon: "fa-heart-pulse",
      meta: "Health and diagnostics",
      available: hasFeature("systemHealth"),
    },
    {
      permission: "settings.view",
      title: "Settings",
      href: "/admin/settings",
      icon: "fa-gear",
      meta: "Tenant configuration",
      available: true,
    },
    {
      permission: "integrations.view",
      title: "Integrations",
      href: "/admin/integrations",
      icon: "fa-plug",
      meta: "Connected services",
      available: hasFeature("apiAccess"),
    },
    {
      permission: "api.view",
      title: "API Access",
      href: "/admin/api",
      icon: "fa-code",
      meta: "API tools",
      available: hasFeature("apiAccess"),
    },
  ];

  return items.filter((item) => item.available && roleAccess.can(item.permission));
}

function buildTenantDashboardShortcuts({
  roleAccess,
  availableModels,
  tenantAccess,
  roleWorkspace,
  dashboardModules,
}) {
  if (roleWorkspace?.shortcuts?.length) {
    return roleWorkspace.shortcuts;
  }

  const hasAnyModel = (...names) => names.some((name) => availableModels.has(name));
  const hasFeature = (name) => tenantAccess?.featureFlags?.[name] !== false;

  const items = [
    {
      permission: "students.manage",
      href: "/admin/students",
      label: "Students",
      icon: "fa-user-graduate",
      available: hasAnyModel("Student"),
    },
    {
      permission: "admissions.manage",
      href: "/admin/admissions/applicants",
      label: "Applicants",
      icon: "fa-user-plus",
      available: hasAnyModel("Applicant"),
    },
    {
      permission: "finance.manage",
      href: "/admin/invoices",
      label: "Billing",
      icon: "fa-file-invoice-dollar",
      available: hasAnyModel("Invoice", "Payment"),
    },
    {
      permission: "messaging.manage",
      href: "/admin/messaging",
      label: "Messaging",
      icon: "fa-comments",
      available: hasAnyModel("Message", "Notification"),
    },
    {
      permission: "announcements.manage",
      href: "/admin/announcements",
      label: "Announcements",
      icon: "fa-bullhorn",
      available: hasAnyModel("Announcement"),
    },
    {
      permission: "reports.view",
      href: "/admin/reports",
      label: "Reports",
      icon: "fa-chart-line",
      available: hasAnyModel("ReportExport"),
    },
    {
      permission: "staff.view",
      href: "/admin/staff",
      label: "Staff",
      icon: "fa-chalkboard-user",
      available: hasAnyModel("Staff"),
    },
    {
      permission: "settings.view",
      href: "/admin/settings",
      label: "Settings",
      icon: "fa-gear",
      available: true,
    },
    {
      permission: "helpdesk.view",
      href: "/admin/helpdesk",
      label: "Helpdesk",
      icon: "fa-headset",
      available: hasFeature("helpdesk"),
    },
  ];

  const filtered = items.filter((item) => item.available && roleAccess.can(item.permission));
  if (filtered.length) return filtered.slice(0, 6);

  return (dashboardModules || []).slice(0, 6).map((item) => ({
    href: item.href,
    label: item.title,
    icon: item.icon,
  }));
}

async function buildRoleWorkspace({ role, models, stats, dashboardData, tenant }) {
  const {
    Announcement,
    Notification,
    LibraryBook,
    LibraryLoan,
    Hostel,
    HostelRoom,
    HostelAllocation,
  } = models || {};

  const announcements = await safeRecentAnnouncements(Announcement);

  if (role === "finance") {
    return {
      title: "Finance Workspace",
      subtitle: "Track collections, balances, refunds, and finance operations.",
      cards: [
        { label: "Collected", value: formatMoney(stats?.finance?.collected || 0, tenant?.currency || "USD"), note: "Month to date", icon: "fa-sack-dollar" },
        { label: "Outstanding", value: formatMoney(stats?.outstandingFees || 0, tenant?.currency || "USD"), note: `${stats?.studentsOwing || 0} students owing`, icon: "fa-file-invoice-dollar" },
        { label: "Refunds", value: formatMoney(stats?.finance?.refunds || 0, tenant?.currency || "USD"), note: "Processed this month", icon: "fa-rotate-left" },
        { label: "Offline Payments", value: formatMoney(stats?.finance?.offlinePayments || 0, tenant?.currency || "USD"), note: "Cash, bank, cheque, transfer", icon: "fa-building-columns" },
      ],
      shortcuts: [
        { href: "/admin/finance", label: "Finance", icon: "fa-credit-card" },
        { href: "/admin/invoices", label: "Invoices", icon: "fa-file-invoice-dollar" },
        { href: "/admin/payments", label: "Payments", icon: "fa-money-bill-wave" },
        { href: "/admin/finance-reports", label: "Finance Reports", icon: "fa-chart-column" },
        { href: "/admin/expenses", label: "Expenses", icon: "fa-money-check-dollar" },
      ],
      announcements,
    };
  }

  if (role === "librarian") {
    const [books, activeLoans, notifications] = await Promise.all([
      safeCount(LibraryBook, { isDeleted: { $ne: true } }),
      safeCount(LibraryLoan, { isDeleted: { $ne: true }, returnedAt: null }),
      safeCount(Notification, { isDeleted: { $ne: true }, isRead: { $ne: true }, audience: { $in: ["admin", "all"] } }),
    ]);

    return {
      title: "Library Workspace",
      subtitle: "Monitor books, active loans, announcements, and library communication.",
      cards: [
        { label: "Books", value: books, note: "Available library records", icon: "fa-book" },
        { label: "Active Loans", value: activeLoans, note: "Not yet returned", icon: "fa-book-reader" },
        { label: "Unread Notices", value: notifications, note: "Admin and all-user notices", icon: "fa-bell" },
        { label: "Announcements", value: announcements.length, note: "Recent school updates", icon: "fa-bullhorn" },
      ],
      shortcuts: [
        { href: "/admin/library", label: "Library", icon: "fa-book-reader" },
        { href: "/admin/announcements", label: "Announcements", icon: "fa-bullhorn" },
        { href: "/admin/notifications", label: "Notifications", icon: "fa-bell" },
        { href: "/admin/profile", label: "Profile", icon: "fa-user-circle" },
      ],
      announcements,
    };
  }

  const [hostels, rooms, allocations, notifications] = await Promise.all([
    safeCount(Hostel, { isDeleted: { $ne: true } }),
    safeCount(HostelRoom, { isDeleted: { $ne: true } }),
    safeCount(HostelAllocation, { isDeleted: { $ne: true } }),
    safeCount(Notification, { isDeleted: { $ne: true }, isRead: { $ne: true }, audience: { $in: ["admin", "all"] } }),
  ]);

  return {
    title: "Hostel Workspace",
    subtitle: "Stay on top of hostels, rooms, allocations, and current announcements.",
    cards: [
      { label: "Hostels", value: hostels, note: "Configured hostel blocks", icon: "fa-building" },
      { label: "Rooms", value: rooms, note: "Available room records", icon: "fa-door-open" },
      { label: "Allocations", value: allocations, note: "Student hostel allocations", icon: "fa-bed" },
      { label: "Unread Notices", value: notifications, note: "Latest shared operational notices", icon: "fa-bell" },
    ],
    shortcuts: [
      { href: "/admin/hostels", label: "Hostels", icon: "fa-building" },
      { href: "/admin/announcements", label: "Announcements", icon: "fa-bullhorn" },
      { href: "/admin/notifications", label: "Notifications", icon: "fa-bell" },
      { href: "/admin/profile", label: "Profile", icon: "fa-user-circle" },
    ],
    announcements,
  };
}
