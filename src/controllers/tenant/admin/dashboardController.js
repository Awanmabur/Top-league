// src/controllers/tenant/dashboard.controller.js

const { getSchoolUi } = require("../../../utils/school-ui");

module.exports = {
  dashboard: async (req, res) => {
    try {
      const tenant = req.tenant;
      const user = req.user;
      const models = req.models || {};

      const tenantAccess = res.locals.tenantAccess || {};
      const schoolLevel = tenantAccess.schoolLevel || "high";
      const ui = getSchoolUi(schoolLevel);

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

      res.render("tenant/dashboard/index", {
        tenant,
        user,
        stats,
        dashboardData,
        ui,
      });
    } catch (error) {
      console.error("Dashboard controller error:", error);

      const tenantAccess = res.locals.tenantAccess || {};
      const schoolLevel = tenantAccess.schoolLevel || "high";
      const ui = getSchoolUi(schoolLevel);

      res.status(500).render("tenant/dashboard/index", {
        tenant: req.tenant,
        user: req.user,
        ui,
        stats: {
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
        },
        dashboardData: {
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
        },
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
