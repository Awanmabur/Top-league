// src/controllers/tenant/admin/dashboard.controller.js

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
      const [
        totalStudents,
        newStudentsThisMonth,
        pendingApps,
        submittedApps,
        verifiedApps,
        acceptedApps,
        outstandingFeesAgg,
        studentsOwing,
        activeUsers,
      ] = await Promise.all([
        safeCount(Student),
        safeCount(Student, { createdAt: { $gte: startOfMonth } }),
        safeCount(Applicant, { status: { $in: ["pending", "submitted", "under_review"] } }),
        safeCount(Applicant, { createdAt: { $gte: startOfMonth } }),
        safeCount(Applicant, { status: "verified", createdAt: { $gte: startOfMonth } }),
        safeCount(Applicant, { status: "accepted", createdAt: { $gte: startOfMonth } }),
        safeAggregate(Invoice, [
        {
          $match: {
            status: { $in: ["pending", "partial", "overdue"] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$balance", "$amount"] } },
          },
        },
        ]),
        safeCount(Invoice, { status: { $in: ["pending", "partial", "overdue"] } }),
        safeCount(User, { isActive: true }),
      ]);

      const outstandingFees = outstandingFeesAgg[0]?.total || 0;

      const portalUptime = 98;
      const avgReviewTime = "48 hrs";

      // Admissions snapshot
      const admissionsTotal =
        submittedApps > 0 ? submittedApps : Math.max(pendingApps + verifiedApps + acceptedApps, 1);

      const submittedPct = admissionsTotal ? Math.round((submittedApps / admissionsTotal) * 100) : 0;
      const verifiedPct = admissionsTotal ? Math.round((verifiedApps / admissionsTotal) * 100) : 0;
      const acceptedPct = admissionsTotal ? Math.round((acceptedApps / admissionsTotal) * 100) : 0;

      const countriesAgg = await safeAggregate(Applicant, [
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
            country: { $exists: true, $ne: null, $ne: "" },
          },
        },
        {
          $group: {
            _id: "$country",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);

      const totalCountryCount = countriesAgg.reduce((sum, item) => sum + item.count, 0) || 1;
      const countryColors = ["#0a6fbf", "#60a5fa", "#7dd3fc", "#a78bfa", "#fb7185"];

      const countries = countriesAgg.map((item, index) => ({
        country: item._id,
        val: Math.round((item.count / totalCountryCount) * 100),
        color: countryColors[index] || "#94a3b8",
      }));

      // Distribution data
      let departments = [];

      if (Student) {
        const classAgg = await safeAggregate(Student, [
          {
            $match: {
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
        ]);

        departments = classAgg.map((d) => ({
          name: d._id || "Unknown",
          val: d.val,
        }));
      }

      // Recent activity
      let recentActivity = [];

      if (AuditLog) {
        const logs = await safeFind(
          AuditLog,
          {},
          "action actorName createdAt meta",
          {
            sort: { createdAt: -1 },
            limit: 6,
          }
        );

        recentActivity = logs.map((log) => ({
          text: log.action || "Activity recorded",
          time: formatTimeAgo(log.createdAt),
        }));
      }

      if (!recentActivity.length) {
        recentActivity = [
          { text: `${submittedApps} new applications submitted`, time: "This month" },
          { text: `${newStudentsThisMonth} new students enrolled`, time: "This month" },
          { text: `${studentsOwing} students have pending balances`, time: "Live" },
          { text: `${activeUsers} active users on the portal`, time: "Live" },
        ];
      }

      // Announcements
      let announcements = [];

      if (Announcement) {
        const rows = await safeFind(
          Announcement,
          {},
          "title status createdAt",
          {
            sort: { createdAt: -1 },
            limit: 4,
          }
        );

        announcements = rows.map((a) => ({
          title: a.title || "Untitled Announcement",
          status: capitalize(a.status || "Draft"),
        }));
      }

      // Recent students
      let recentStudents = [];

      if (Student) {
        const rows = await Student.find({})
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();

        recentStudents = rows.map((s) => ({
          name:
            s.fullName ||
            s.name ||
            `${s.firstName || ""} ${s.lastName || ""}`.trim() ||
            "Student",
          program: [s.classLevel, s.section || s.stream].filter(Boolean).join(" ") || s.className || "—",
          status: s.status || "Active",
          balance: formatMoney(s.balance || 0, tenant?.currency || "USD"),
        }));
      }

      // Pending applications table
      let pendingApplicationsTable = [];

      if (Applicant) {
        const rows = await Applicant.find({
          status: { $in: ["pending", "submitted", "under_review"] },
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate("section1", "code name classLevel classStream")
          .populate("program1", "code name classLevel classStream")
          .lean();

        pendingApplicationsTable = rows.map((a) => ({
          id: a._id,
          name:
            a.fullName ||
            a.name ||
            `${a.firstName || ""} ${a.lastName || ""}`.trim() ||
            "Applicant",
          program: a.section1
            ? ((a.section1.code ? `${a.section1.code} — ` : "") + (a.section1.name || a.section1.className || "Section"))
            : (a.program1 ? ((a.program1.code ? `${a.program1.code} — ` : "") + (a.program1.name || a.program1.className || "Section")) : "—"),
          country: a.nationality || "—",
        }));
      }

      // Finance snapshot
      const [collectedAgg, refundsAgg, offlineAgg, monthlyRevenueAgg] = await Promise.all([
        safeAggregate(Payment, [
        {
          $match: {
            createdAt: { $gte: startOfMonth },
            status: { $in: ["paid", "completed", "success"] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
        ]),

        safeAggregate(Payment, [
        {
          $match: {
            createdAt: { $gte: startOfMonth },
            status: "refunded",
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
        ]),

        safeAggregate(Payment, [
        {
          $match: {
            createdAt: { $gte: startOfMonth },
            channel: { $in: ["cash", "bank", "offline"] },
            status: { $in: ["paid", "completed", "success"] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
        ]),
        safeAggregate(Payment, [
        {
          $match: {
            status: { $in: ["paid", "completed", "success"] },
            createdAt: {
              $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1),
            },
          },
        },
        {
          $group: {
            _id: {
              month: { $month: "$createdAt" },
              year: { $year: "$createdAt" },
            },
            total: { $sum: "$amount" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        ]),
      ]);

      const finance = {
        collected: collectedAgg[0]?.total || 0,
        pending: outstandingFees,
        refunds: refundsAgg[0]?.total || 0,
        offlinePayments: offlineAgg[0]?.total || 0,
      };

      // Revenue trend

      const revenue = buildMonthlySeries(monthlyRevenueAgg, now);

      const dashboardData = {
        studentsTrend: buildSoftTrend(totalStudents, newStudentsThisMonth, 15),
        appsTrend: buildSoftTrend(pendingApps, submittedApps, 15),
        feesTrend: buildSoftTrend(outstandingFees, studentsOwing, 15),
        uptimeTrend: [99, 99, 98.9, 99.1, 98.7, 98.9, 99.2, 98.8, 99, 98.6, 98.9, 99.1, 98.9, 98.8, 98],
        countries,
        departments,
        recentStudents,
        pendingApps: pendingApplicationsTable,
        revenue,
        recentActivity,
        announcements,
        systemStatus: {
          uptime: 99.2,
          errors24h: 13,
          dbLag: "0s",
          storage: 64,
        },
        admissions: {
          submitted: submittedApps,
          verified: verifiedApps,
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

      res.render("tenant/admin/dashboard/index", {
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

      res.status(500).render("tenant/admin/dashboard/index", {
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

function buildSoftTrend(primaryValue = 0, secondaryValue = 0, length = 15) {
  const base = Number(primaryValue || 0);
  const delta = Number(secondaryValue || 0);
  const start = Math.max(1, Math.round(base - delta));
  const step = Math.max(1, Math.round((base - start) / Math.max(1, length - 1)));

  return Array.from({ length }, (_, i) => start + step * i);
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
