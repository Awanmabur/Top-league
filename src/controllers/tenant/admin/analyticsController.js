const mongoose = require("mongoose");
const { getSchoolUnits } = require("../../../utils/academicStructure");

function safeStr(v, def = "") {
  if (v === null || v === undefined) return def;
  return String(v);
}

function safeNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function pctChange(now, prev) {
  const current = safeNum(now, 0);
  const before = safeNum(prev, 0);
  if (before === 0) return current > 0 ? 100 : 0;
  return ((current - before) / before) * 100;
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildWeekBuckets(weeks = 12) {
  const now = startOfDay(new Date());
  const buckets = [];
  const labels = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = addDays(now, -(i * 7));
    const weekStart = addDays(weekEnd, -7);

    buckets.push({
      index: weeks - 1 - i,
      start: weekStart,
      end: weekEnd,
    });

    labels.push(weekStart.toISOString().slice(5, 10));
  }

  return { buckets, labels };
}

async function buildWeeklyCountFast(Model, match, weeks = 12) {
  if (!Model) return { labels: [], values: [] };

  const { buckets, labels } = buildWeekBuckets(weeks);
  if (!buckets.length) return { labels: [], values: [] };

  const firstStart = buckets[0].start;
  const lastEnd = buckets[buckets.length - 1].end;

  const rows = await Model.aggregate([
    {
      $match: {
        ...(match || {}),
        createdAt: { $gte: firstStart, $lt: lastEnd },
      },
    },
    {
      $project: {
        weekIndex: {
          $floor: {
            $divide: [
              { $subtract: ["$createdAt", firstStart] },
              7 * 24 * 60 * 60 * 1000,
            ],
          },
        },
      },
    },
    { $match: { weekIndex: { $gte: 0, $lt: weeks } } },
    { $group: { _id: "$weekIndex", total: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const values = Array(weeks).fill(0);
  rows.forEach((row) => {
    const idx = safeNum(row._id, -1);
    if (idx >= 0 && idx < weeks) values[idx] = safeNum(row.total, 0);
  });

  return { labels, values };
}

async function buildWeeklySumFast(Model, field, match, weeks = 12) {
  if (!Model) return { labels: [], values: [] };

  const { buckets, labels } = buildWeekBuckets(weeks);
  if (!buckets.length) return { labels: [], values: [] };

  const firstStart = buckets[0].start;
  const lastEnd = buckets[buckets.length - 1].end;

  const rows = await Model.aggregate([
    {
      $match: {
        ...(match || {}),
        createdAt: { $gte: firstStart, $lt: lastEnd },
      },
    },
    {
      $project: {
        amountValue: { $ifNull: [`$${field}`, 0] },
        weekIndex: {
          $floor: {
            $divide: [
              { $subtract: ["$createdAt", firstStart] },
              7 * 24 * 60 * 60 * 1000,
            ],
          },
        },
      },
    },
    { $match: { weekIndex: { $gte: 0, $lt: weeks } } },
    { $group: { _id: "$weekIndex", total: { $sum: "$amountValue" } } },
    { $sort: { _id: 1 } },
  ]);

  const values = Array(weeks).fill(0);
  rows.forEach((row) => {
    const idx = safeNum(row._id, -1);
    if (idx >= 0 && idx < weeks) values[idx] = safeNum(row.total, 0);
  });

  return { labels, values };
}

function perfEnabled() {
  return process.env.DEBUG_ANALYTICS === "1";
}

function perfLog(label, startedAt) {
  if (perfEnabled()) {
    console.log(`[analytics] ${label}: ${Date.now() - startedAt}ms`);
  }
}

function modelHasPath(Model, path) {
  try {
    return !!Model?.schema?.path(path);
  } catch (_) {
    return false;
  }
}

function buildSchoolUnitFilter(Model, schoolUnit) {
  const value = safeStr(schoolUnit, "all").trim();
  if (!value || value === "all") return {};

  if (modelHasPath(Model, "schoolUnitCode")) return { schoolUnitCode: value };
  if (modelHasPath(Model, "schoolUnitId")) {
    return mongoose.Types.ObjectId.isValid(value) ? { schoolUnitId: value } : {};
  }
  if (modelHasPath(Model, "schoolUnitName")) {
    return { schoolUnitName: new RegExp(`^${escapeRegex(value)}$`, "i") };
  }

  return {};
}

module.exports = {
  analyticsPage: async (req, res) => {
    const totalStartedAt = Date.now();

    try {
      const models = req.models || {};
      const Student = models.Student || null;
      const Applicant = models.Applicant || null;
      const Invoice = models.Invoice || null;
      const Payment = models.Payment || null;
      const SectionModel = models.Section || null;

      const range = clamp(parseInt(req.query.range, 10) || 90, 30, 365);
      const schoolUnit = safeStr(req.query.schoolUnit || req.query.campus, "all").trim();
      const year = safeStr(req.query.year, "2025").trim();
      const search = safeStr(req.query.search, "").trim().slice(0, 80);

      const now = new Date();
      const from = addDays(now, -range);
      const prevFrom = addDays(from, -range);
      const matchTenantSoftDelete = { isDeleted: { $ne: true } };

      const studentMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Student, schoolUnit),
      };
      const applicantMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Applicant, schoolUnit),
      };
      const invoiceMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Invoice, schoolUnit),
      };
      const paymentMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Payment, schoolUnit),
      };
      const sectionMatch = buildSchoolUnitFilter(SectionModel, schoolUnit);

      const [
        activeStudents,
        activeStudentsPrev,
        newApplications,
        newApplicationsPrev,
        revenueAgg,
        revenueAggPrev,
        overdueInvoices,
        appTrend,
        payTrend,
        studentsBySection,
        outstandingBySection,
        sections,
        feeBreakdownRaw,
      ] = await Promise.all([
        Student
          ? Student.countDocuments({ ...studentMatch, status: "active" })
          : Promise.resolve(0),
        Student
          ? Student.countDocuments({
              ...studentMatch,
              status: "active",
              createdAt: { $lt: from },
            })
          : Promise.resolve(0),
        Applicant
          ? Applicant.countDocuments({
              ...applicantMatch,
              createdAt: { $gte: from },
            })
          : Promise.resolve(0),
        Applicant
          ? Applicant.countDocuments({
              ...applicantMatch,
              createdAt: { $gte: prevFrom, $lt: from },
            })
          : Promise.resolve(0),
        Payment
          ? Payment.aggregate([
              { $match: { ...paymentMatch, createdAt: { $gte: from } } },
              { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
            ])
          : Promise.resolve([]),
        Payment
          ? Payment.aggregate([
              { $match: { ...paymentMatch, createdAt: { $gte: prevFrom, $lt: from } } },
              { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
            ])
          : Promise.resolve([]),
        Invoice
          ? Invoice.countDocuments({
              ...invoiceMatch,
              dueDate: { $lt: now },
              balance: { $gt: 0 },
              status: { $nin: ["Paid", "Cancelled", "Draft"] },
            })
          : Promise.resolve(0),
        buildWeeklyCountFast(Applicant, applicantMatch, 12),
        buildWeeklySumFast(Payment, "amount", paymentMatch, 12),
        Student
          ? Student.aggregate([
              { $match: { ...studentMatch } },
              { $group: { _id: "$sectionId", students: { $sum: 1 } } },
            ])
          : Promise.resolve([]),
        Invoice && Student
          ? Invoice.aggregate([
              {
                $match: {
                  ...invoiceMatch,
                  status: { $in: ["Unpaid", "Partially Paid", "Overdue"] },
                },
              },
              {
                $lookup: {
                  from: Student.collection.name,
                  localField: "studentId",
                  foreignField: "_id",
                  as: "st",
                },
              },
              { $unwind: "$st" },
              {
                $group: {
                  _id: "$st.sectionId",
                  outstanding: {
                    $sum: {
                      $max: [
                        0,
                        {
                          $subtract: [
                            { $ifNull: ["$totalAmount", 0] },
                            { $ifNull: ["$paidAmount", 0] },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            ])
          : Promise.resolve([]),
        SectionModel
          ? SectionModel.find({ ...sectionMatch })
              .select("_id code name className classLevel classStream streamName")
              .sort({ classLevel: 1, classStream: 1, name: 1 })
              .lean()
          : Promise.resolve([]),
        Invoice
          ? Invoice.aggregate([
              { $match: { ...invoiceMatch, createdAt: { $gte: from } } },
              { $unwind: { path: "$items", preserveNullAndEmptyArrays: false } },
              {
                $group: {
                  _id: { $ifNull: ["$items.category", "Other"] },
                  total: { $sum: { $ifNull: ["$items.amount", 0] } },
                },
              },
              { $sort: { total: -1 } },
              { $limit: 8 },
            ])
          : Promise.resolve([]),
      ]);

      const revenueCollected = revenueAgg?.[0]?.total ? safeNum(revenueAgg[0].total, 0) : 0;
      const revenuePrev = revenueAggPrev?.[0]?.total ? safeNum(revenueAggPrev[0].total, 0) : 0;

      const studentMap = new Map((studentsBySection || []).map((x) => [String(x._id || ""), safeNum(x.students, 0)]));
      const outstandingMap = new Map((outstandingBySection || []).map((x) => [String(x._id || ""), safeNum(x.outstanding, 0)]));
      const regex = search ? new RegExp(escapeRegex(search), "i") : null;

      const formatSectionLabel = (section) => {
        if (!section) return "Section";
        const code = safeStr(section.code).trim();
        const main = safeStr(section.name || section.className || section.classLevel || "Section").trim();
        const tail = [safeStr(section.classLevel).trim(), safeStr(section.classStream || section.streamName).trim()]
          .filter(Boolean)
          .join(" - ");

        if (code && tail) return `${code} - ${main} - ${tail}`;
        if (code) return `${code} - ${main}`;
        if (tail && main !== tail) return `${main} - ${tail}`;
        return main || "Section";
      };

      let programRows = (sections || []).map((section) => {
        const sid = String(section._id || "");
        return {
          _id: section._id,
          label: formatSectionLabel(section),
          students: studentMap.get(sid) || 0,
          outstanding: outstandingMap.get(sid) || 0,
          attendance: null,
          passRate: null,
        };
      });

      if (regex) {
        programRows = programRows.filter((row) => regex.test(row.label));
      }

      programRows.sort((a, b) => {
        const studentDiff = safeNum(b.students) - safeNum(a.students);
        if (studentDiff !== 0) return studentDiff;
        return safeNum(b.outstanding) - safeNum(a.outstanding);
      });

      const feeBreakdown = (feeBreakdownRaw || []).map((x) => {
        const totalPaid = (feeBreakdownRaw || []).reduce((sum, row) => sum + safeNum(row.total, 0), 0) || 1;
        const amount = safeNum(x.total, 0);
        const key = safeStr(x._id, "Other").trim() || "Other";
        return {
          key,
          label: key,
          amount,
          pct: Math.round((amount / totalPaid) * 100),
        };
      });

      const alerts = [];
      if (overdueInvoices > 0) {
        alerts.push({
          title: "Overdue invoices need follow-up",
          meta: `${overdueInvoices} invoice(s) are overdue`,
          href: "/admin/invoices?status=Unpaid",
          level: "warn",
        });
      }
      if (newApplications > 0) {
        alerts.push({
          title: "New applications received",
          meta: `${newApplications} new application(s) in the selected range`,
          href: "/admin/admissions/applicants",
          level: "info",
        });
      }
      if (!programRows.length) {
        alerts.push({
          title: "No section analytics available",
          meta: "No matching section rows were found for this filter.",
          href: "/admin/sections",
          level: "info",
        });
      }

      const academicYears = [year, String(Number(year) - 1), String(Number(year) - 2)].filter((value, index, arr) => value && arr.indexOf(value) === index);

      perfLog("total", totalStartedAt);
      res.set("Cache-Control", "private, max-age=60");

      return res.render("tenant/analytics/index", {
        tenant: req.tenant || null,
        csrfToken: res.locals.csrfToken || null,
        query: { range, schoolUnit, year, search },
        academicYears,
        schoolUnitOptions: getSchoolUnits(req).map((unit) => ({
          value: unit.code || unit.id || "",
          label: unit.name || "School Unit",
        })),
        kpis: {
          activeStudents,
          activeStudentsDelta: pctChange(activeStudents, activeStudentsPrev),
          newApplications,
          newApplicationsDelta: pctChange(newApplications, newApplicationsPrev),
          revenueCollected,
          revenueDelta: pctChange(revenueCollected, revenuePrev),
          atRisk: overdueInvoices,
        },
        trends: {
          applications: appTrend,
          payments: payTrend,
        },
        feeBreakdown,
        programRows,
        alerts,
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("ANALYTICS PAGE ERROR:", err);
      return res.status(500).send("Failed to load analytics.");
    }
  },

  exportAnalyticsCsv: async (req, res) => {
    try {
      const models = req.models || {};
      const Student = models.Student || null;
      const Applicant = models.Applicant || null;
      const Invoice = models.Invoice || null;
      const Payment = models.Payment || null;
      const SectionModel = models.Section || null;

      const range = clamp(parseInt(req.query.range, 10) || 90, 30, 365);
      const schoolUnit = safeStr(req.query.schoolUnit || req.query.campus, "all").trim();
      const search = safeStr(req.query.search, "").trim().slice(0, 80);

      const now = new Date();
      const from = addDays(now, -range);
      const matchTenantSoftDelete = { isDeleted: { $ne: true } };
      const studentMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Student, schoolUnit),
      };
      const applicantMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Applicant, schoolUnit),
      };
      const invoiceMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Invoice, schoolUnit),
      };
      const paymentMatch = {
        ...matchTenantSoftDelete,
        ...buildSchoolUnitFilter(Payment, schoolUnit),
      };
      const sectionMatch = buildSchoolUnitFilter(SectionModel, schoolUnit);

      const [
        activeStudents,
        newApplications,
        revenueAgg,
        overdueInvoices,
        studentsBySection,
        outstandingBySection,
        sections,
      ] = await Promise.all([
        Student ? Student.countDocuments({ ...studentMatch, status: "active" }) : Promise.resolve(0),
        Applicant ? Applicant.countDocuments({ ...applicantMatch, createdAt: { $gte: from } }) : Promise.resolve(0),
        Payment
          ? Payment.aggregate([
              { $match: { ...paymentMatch, createdAt: { $gte: from } } },
              { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
            ])
          : Promise.resolve([]),
        Invoice
          ? Invoice.countDocuments({
              ...invoiceMatch,
              dueDate: { $lt: now },
              balance: { $gt: 0 },
              status: { $nin: ["Paid", "Cancelled", "Draft"] },
            })
          : Promise.resolve(0),
        Student
          ? Student.aggregate([
              { $match: { ...studentMatch } },
              { $group: { _id: "$sectionId", students: { $sum: 1 } } },
            ])
          : Promise.resolve([]),
        Invoice && Student
          ? Invoice.aggregate([
              {
                $match: {
                  ...invoiceMatch,
                  status: { $in: ["Unpaid", "Partially Paid", "Overdue"] },
                },
              },
              {
                $lookup: {
                  from: Student.collection.name,
                  localField: "studentId",
                  foreignField: "_id",
                  as: "st",
                },
              },
              { $unwind: "$st" },
              {
                $group: {
                  _id: "$st.sectionId",
                  outstanding: {
                    $sum: {
                      $max: [
                        0,
                        {
                          $subtract: [
                            { $ifNull: ["$totalAmount", 0] },
                            { $ifNull: ["$paidAmount", 0] },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            ])
          : Promise.resolve([]),
        SectionModel
          ? SectionModel.find({ ...sectionMatch })
              .select("_id code name className classLevel classStream streamName")
              .sort({ classLevel: 1, classStream: 1, name: 1 })
              .lean()
          : Promise.resolve([]),
      ]);

      const revenueCollected = revenueAgg?.[0]?.total ? safeNum(revenueAgg[0].total, 0) : 0;
      const studentMap = new Map((studentsBySection || []).map((x) => [String(x._id || ""), safeNum(x.students, 0)]));
      const outstandingMap = new Map((outstandingBySection || []).map((x) => [String(x._id || ""), safeNum(x.outstanding, 0)]));
      const regex = search ? new RegExp(escapeRegex(search), "i") : null;

      const formatSectionLabel = (section) => {
        if (!section) return "Section";
        const code = safeStr(section.code).trim();
        const main = safeStr(section.name || section.className || section.classLevel || "Section").trim();
        const tail = [safeStr(section.classLevel).trim(), safeStr(section.classStream || section.streamName).trim()]
          .filter(Boolean)
          .join(" - ");

        if (code && tail) return `${code} - ${main} - ${tail}`;
        if (code) return `${code} - ${main}`;
        if (tail && main !== tail) return `${main} - ${tail}`;
        return main || "Section";
      };

      let programRows = (sections || []).map((section) => {
        const sid = String(section._id || "");
        return {
          label: formatSectionLabel(section),
          students: studentMap.get(sid) || 0,
          outstanding: outstandingMap.get(sid) || 0,
          attendance: "",
          passRate: "",
        };
      });

      if (regex) {
        programRows = programRows.filter((row) => regex.test(row.label));
      }

      const rows = [
        ["Metric", "Value"],
        ["Active Students", activeStudents],
        [`New Applications (last ${range} days)`, newApplications],
        [`Revenue Collected (last ${range} days)`, revenueCollected],
        ["Overdue Invoices", overdueInvoices],
        [],
        ["Section", "Students", "Outstanding (UGX)", "Attendance", "Pass Rate"],
        ...programRows.map((row) => [
          row.label,
          row.students,
          row.outstanding,
          row.attendance,
          row.passRate,
        ]),
      ];

      const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="analytics-${Date.now()}.csv"`);
      return res.status(200).send(csv);
    } catch (err) {
      console.error("EXPORT ANALYTICS ERROR:", err);
      return res.status(500).send("Failed to export analytics.");
    }
  },
};