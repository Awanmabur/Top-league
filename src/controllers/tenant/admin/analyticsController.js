const { getSchoolUnits } = require("../../../utils/academicStructure");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const reportCtl = require("../../../services/tenant/reportControlService");
const { storeCsvArtifact } = require("../../../services/tenant/reportArtifactService");

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

function csvCell(value) { return reportCtl.csvCell(value); }

function normalizeAcademicYear(value, timezone = "UTC") {
  const raw = safeStr(value, reportCtl.currentYear(timezone)).trim().slice(0, 20);
  return /^[A-Za-z0-9][A-Za-z0-9/_ -]{0,19}$/.test(raw) ? raw : reportCtl.currentYear(timezone);
}

function previousAcademicYear(value, offset = 1) {
  const raw = safeStr(value).trim();
  let m = raw.match(/^(\d{4})$/);
  if (m) return String(Number(m[1]) - offset);
  m = raw.match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (m) return `${Number(m[1]) - offset}/${Number(m[2]) - offset}`;
  return "";
}

function buildWeekBuckets(weeks = 12, from = null, to = new Date()) {
  const end = to instanceof Date ? new Date(to) : new Date(to);
  const count = clamp(Number(weeks) || 12, 1, 53);
  const start = from instanceof Date ? new Date(from) : addDays(end, -(count * 7));
  const buckets = [];
  const labels = [];
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const bucketStart = new Date(start.getTime() + (i * weekMs));
    const bucketEnd = i === count - 1 ? end : new Date(Math.min(end.getTime(), bucketStart.getTime() + weekMs));
    buckets.push({ index: i, start: bucketStart, end: bucketEnd });
    labels.push(bucketStart.toISOString().slice(5, 10));
  }
  return { buckets, labels };
}

async function buildWeeklyCountFast(Model, match, weeks = 12, from = null, to = new Date()) {
  if (!Model) return { labels: [], values: [] };
  const { buckets, labels } = buildWeekBuckets(weeks, from, to);
  if (!buckets.length) return { labels: [], values: [] };
  const firstStart = buckets[0].start;
  const lastEnd = buckets[buckets.length - 1].end;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const rows = await Model.aggregate([
    { $match: { ...(match || {}), createdAt: { $gte: firstStart, $lte: lastEnd } } },
    { $project: { weekIndex: { $floor: { $divide: [{ $subtract: ["$createdAt", firstStart] }, weekMs] } } } },
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

function buildSchoolUnitFilter(Model, schoolUnit) {
  return reportCtl.strictModelScope(Model, schoolUnit);
}

function prefixMatch(match, prefix) {
  const out = {};
  for (const [key, value] of Object.entries(match || {})) {
    if (key.startsWith("$")) continue;
    out[`${prefix}.${key}`] = value;
  }
  return out;
}

function studentScopeStages(Student, schoolUnit, alias = "__scopeStudent") {
  if (!Student || !schoolUnit || schoolUnit === "all") return [];
  const scope = buildSchoolUnitFilter(Student, schoolUnit);
  return [
    { $lookup: { from: Student.collection.name, localField: "studentId", foreignField: "_id", as: alias } },
    { $unwind: `$${alias}` },
    { $match: { [`${alias}.isDeleted`]: { $ne: true }, ...prefixMatch(scope, alias) } },
  ];
}

async function scopedAggregate(Model, Student, baseMatch, schoolUnit, stages = []) {
  if (!Model) return [];
  return Model.aggregate([
    { $match: baseMatch || {} },
    ...studentScopeStages(Student, schoolUnit),
    ...stages,
  ]);
}

async function buildWeeklySumFast(Model, field, match, weeks = 12, dateField = "createdAt", options = {}) {
  if (!Model) return { labels: [], values: [] };
  const { from = null, to = new Date(), Student = null, schoolUnit = "all" } = options;
  const { buckets, labels } = buildWeekBuckets(weeks, from, to);
  if (!buckets.length) return { labels: [], values: [] };
  const firstStart = buckets[0].start;
  const lastEnd = buckets[buckets.length - 1].end;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const rows = await scopedAggregate(Model, Student, {
    ...(match || {}), [dateField]: { $gte: firstStart, $lte: lastEnd },
  }, schoolUnit, [
    { $project: {
      amountValue: { $ifNull: [`$${field}`, 0] },
      weekIndex: { $floor: { $divide: [{ $subtract: [`$${dateField}`, firstStart] }, weekMs] } },
    } },
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

function formatSectionLabel(section) {
  if (!section) return "Section";
  const code = safeStr(section.code).trim();
  const main = safeStr(section.name || section.className || section.classLevel || "Section").trim();
  const tail = [safeStr(section.classLevel).trim(), safeStr(section.classStream || section.streamName).trim()]
    .filter(Boolean).join(" - ");
  if (code && tail) return `${code} - ${main} - ${tail}`;
  if (code) return `${code} - ${main}`;
  if (tail && main !== tail) return `${main} - ${tail}`;
  return main || "Section";
}

async function buildAnalyticsSnapshot(req) {
  const models = req.models || {};
  const { Student, Applicant, Invoice, Payment, Section: SectionModel, Class, Attendance, Result } = models;
  const timezone = req.tenant?.timezone || "UTC";
  const range = clamp(parseInt(req.query.range, 10) || 90, 30, 365);
  const schoolUnit = safeStr(req.query.schoolUnit || req.query.campus, "all").trim().slice(0, 100) || "all";
  const year = normalizeAcademicYear(req.query.year, timezone);
  const search = safeStr(req.query.search, "").trim().slice(0, 80);
  const now = new Date();
  const from = addDays(now, -range);
  const prevFrom = addDays(from, -range);
  const weeks = clamp(Math.ceil(range / 7), 1, 53);
  const soft = { isDeleted: { $ne: true } };

  const studentMatch = { ...soft, ...buildSchoolUnitFilter(Student, schoolUnit), academicYear: year };
  const applicantMatch = { ...soft, ...buildSchoolUnitFilter(Applicant, schoolUnit), academicYear: year };
  const invoiceMatch = { ...soft, academicYear: year };
  const paymentMatch = { ...soft, academicYear: year, status: "Completed" };
  const classMatch = { ...buildSchoolUnitFilter(Class, schoolUnit), academicYear: year, status: { $ne: "archived" } };
  const classRows = await Class.find(classMatch).select("_id").lean();
  const classIds = classRows.map((row) => row._id).filter(Boolean);
  const sectionMatch = {
    ...buildSchoolUnitFilter(SectionModel, schoolUnit),
    classId: { $in: classIds },
    status: { $ne: "archived" },
  };

  const revenueCurrentPromise = scopedAggregate(Payment, Student, {
    ...paymentMatch, paymentDate: { $gte: from, $lte: now },
  }, schoolUnit, [{ $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } }]);
  const revenuePreviousPromise = scopedAggregate(Payment, Student, {
    ...paymentMatch, paymentDate: { $gte: prevFrom, $lt: from },
  }, schoolUnit, [{ $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } }]);
  const overduePromise = scopedAggregate(Invoice, Student, {
    ...invoiceMatch,
    dueDate: { $lt: now }, balance: { $gt: 0 },
    status: { $nin: ["Paid", "Cancelled", "Draft"] },
  }, schoolUnit, [{ $count: "total" }]);
  const outstandingPromise = scopedAggregate(Invoice, Student, {
    ...invoiceMatch, status: { $in: ["Unpaid", "Partially Paid", "Overdue"] },
  }, schoolUnit, [
    { $lookup: { from: Student.collection.name, localField: "studentId", foreignField: "_id", as: "__student" } },
    { $unwind: "$__student" },
    { $group: {
      _id: "$__student.sectionId",
      outstanding: { $sum: { $max: [0, { $subtract: [{ $ifNull: ["$totalAmount", 0] }, { $ifNull: ["$paidAmount", 0] }] }] } },
    } },
  ]);
  const billingBreakdownPromise = scopedAggregate(Invoice, Student, {
    ...invoiceMatch, issueDate: { $gte: from, $lte: now },
  }, schoolUnit, [
    { $unwind: { path: "$items", preserveNullAndEmptyArrays: false } },
    { $group: { _id: { $ifNull: ["$items.category", "Other"] }, total: { $sum: { $ifNull: ["$items.amount", 0] } } } },
    { $sort: { total: -1 } },
    { $limit: 8 },
  ]);

  const [
    activeStudents, newApplications, newApplicationsPrev, revenueAgg, revenueAggPrev, overdueRows,
    appTrend, payTrend, studentsBySection, outstandingBySection, sections, attendanceRows, resultRows, feeBreakdownRaw,
  ] = await Promise.all([
    Student.countDocuments({ ...studentMatch, status: "active" }),
    Applicant.countDocuments({ ...applicantMatch, createdAt: { $gte: from, $lte: now } }),
    Applicant.countDocuments({ ...applicantMatch, createdAt: { $gte: prevFrom, $lt: from } }),
    revenueCurrentPromise,
    revenuePreviousPromise,
    overduePromise,
    buildWeeklyCountFast(Applicant, applicantMatch, weeks, from, now),
    buildWeeklySumFast(Payment, "amount", paymentMatch, weeks, "paymentDate", { from, to: now, Student, schoolUnit }),
    Student.aggregate([
      { $match: { ...studentMatch, status: "active" } },
      { $group: { _id: "$sectionId", students: { $sum: 1 } } },
    ]),
    outstandingPromise,
    SectionModel.find(sectionMatch)
      .select("_id code name className classLevel classStream streamName classId")
      .sort({ classLevel: 1, classStream: 1, name: 1 }).lean(),
    Attendance.aggregate([
      { $match: {
        academicYear: year, isDeleted: { $ne: true }, migrationQuarantinedAt: null,
        attendanceDate: { $gte: from, $lte: now }, sectionId: { $ne: null },
      } },
      { $group: {
        _id: "$sectionId",
        eligible: { $sum: { $cond: [{ $ne: ["$status", "excused"] }, 1, 0] } },
        attended: { $sum: { $cond: [{ $in: ["$status", ["present", "late"]] }, 1, 0] } },
      } },
    ]),
    Result.aggregate([
      { $match: {
        academicYear: year, status: "published", migrationQuarantinedAt: null, sectionId: { $ne: null },
        createdAt: { $gte: from, $lte: now },
      } },
      { $group: {
        _id: "$sectionId", total: { $sum: 1 },
        passed: { $sum: { $cond: [{ $gte: ["$score", "$passMark"] }, 1, 0] } },
      } },
    ]),
    billingBreakdownPromise,
  ]);

  const revenueCollected = safeNum(revenueAgg?.[0]?.total, 0);
  const revenuePrev = safeNum(revenueAggPrev?.[0]?.total, 0);
  const overdueInvoices = safeNum(overdueRows?.[0]?.total, 0);
  const studentMap = new Map((studentsBySection || []).map((x) => [String(x._id || ""), safeNum(x.students, 0)]));
  const outstandingMap = new Map((outstandingBySection || []).map((x) => [String(x._id || ""), safeNum(x.outstanding, 0)]));
  const attendanceMap = new Map((attendanceRows || []).map((x) => [String(x._id || ""), x]));
  const resultMap = new Map((resultRows || []).map((x) => [String(x._id || ""), x]));
  const regex = search ? new RegExp(escapeRegex(search), "i") : null;

  let programRows = (sections || []).map((section) => {
    const sid = String(section._id || "");
    const attendance = attendanceMap.get(sid);
    const results = resultMap.get(sid);
    const eligible = safeNum(attendance?.eligible, 0);
    const totalResults = safeNum(results?.total, 0);
    return {
      _id: section._id,
      label: formatSectionLabel(section),
      students: studentMap.get(sid) || 0,
      outstanding: outstandingMap.get(sid) || 0,
      attendance: eligible > 0 ? Math.round((safeNum(attendance?.attended, 0) / eligible) * 1000) / 10 : null,
      passRate: totalResults > 0 ? Math.round((safeNum(results?.passed, 0) / totalResults) * 1000) / 10 : null,
    };
  });
  if (regex) programRows = programRows.filter((row) => regex.test(row.label));
  programRows.sort((a, b) => safeNum(b.students) - safeNum(a.students) || safeNum(b.outstanding) - safeNum(a.outstanding));

  const billingTotal = (feeBreakdownRaw || []).reduce((sum, row) => sum + safeNum(row.total, 0), 0) || 1;
  const feeBreakdown = (feeBreakdownRaw || []).map((x) => {
    const amount = safeNum(x.total, 0);
    const key = safeStr(x._id, "Other").trim() || "Other";
    return { key, label: key, amount, pct: Math.round((amount / billingTotal) * 100) };
  });

  const alerts = [];
  if (overdueInvoices > 0) alerts.push({ title: "Overdue invoices need follow-up", meta: `${overdueInvoices} invoice(s) are overdue`, href: "/admin/invoices?status=Unpaid", level: "warn" });
  if (newApplications > 0) alerts.push({ title: "New applications received", meta: `${newApplications} new application(s) in the selected range`, href: "/admin/admissions/applicants", level: "info" });
  if (!programRows.length) alerts.push({ title: "No section analytics available", meta: "No matching section rows were found for this filter.", href: "/admin/sections", level: "info" });

  const academicYears = [year, previousAcademicYear(year, 1), previousAcademicYear(year, 2)]
    .filter((value, index, arr) => value && arr.indexOf(value) === index);
  return {
    query: { range, schoolUnit, year, search }, academicYears,
    schoolUnitOptions: getSchoolUnits(req).map((unit) => ({ value: unit.code || unit.id || "", label: unit.name || "School Unit" })),
    kpis: {
      activeStudents, activeStudentsDelta: null, newApplications,
      newApplicationsDelta: pctChange(newApplications, newApplicationsPrev),
      revenueCollected, revenueDelta: pctChange(revenueCollected, revenuePrev), atRisk: overdueInvoices,
    },
    trends: { applications: appTrend, payments: payTrend }, feeBreakdown, programRows, alerts,
  };
}

function perfEnabled() { return process.env.DEBUG_ANALYTICS === "1"; }
function perfLog(label, startedAt) { if (perfEnabled()) console.log(`[analytics] ${label}: ${Date.now() - startedAt}ms`); }

module.exports = {
  analyticsPage: async (req, res) => {
    const totalStartedAt = Date.now();
    try {
      const snapshot = await buildAnalyticsSnapshot(req);
      perfLog("total", totalStartedAt);
      res.set("Cache-Control", "private, max-age=60");
      return res.render("tenant/analytics/index", {
        tenant: req.tenant || null,
        csrfToken: res.locals.csrfToken || null,
        query: snapshot.query,
        academicYears: snapshot.academicYears,
        schoolUnitOptions: snapshot.schoolUnitOptions,
        kpis: snapshot.kpis,
        trends: snapshot.trends,
        feeBreakdown: snapshot.feeBreakdown,
        programRows: snapshot.programRows,
        alerts: snapshot.alerts,
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
      const snapshot = await buildAnalyticsSnapshot(req);
      const rows = [
        ["Metric", "Value"],
        ["Academic Year", snapshot.query.year],
        ["Active Students", snapshot.kpis.activeStudents],
        [`New Applications (last ${snapshot.query.range} days)`, snapshot.kpis.newApplications],
        [`Revenue Collected (last ${snapshot.query.range} days)`, snapshot.kpis.revenueCollected],
        ["Overdue Invoices", snapshot.kpis.atRisk],
        [],
        ["Section", "Students", "Outstanding (UGX)", "Attendance %", "Pass Rate %"],
        ...snapshot.programRows.map((row) => [
          row.label, row.students, row.outstanding,
          row.attendance === null ? "" : row.attendance,
          row.passRate === null ? "" : row.passRate,
        ]),
      ];
      const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
      const buffer = Buffer.from(csv, "utf8");
      const fileName = `analytics-${snapshot.query.year.replace(/[^A-Za-z0-9_-]+/g, "-")}-${Date.now()}.csv`;
      await storeCsvArtifact({
        ReportExport: req.models?.ReportExport,
        uploadBuffer, safeDestroy,
        tenantCode: req.tenant?.code || req.tenant?._id || "tenant",
        type: "analytics_summary", source: "export", filters: snapshot.query,
        buffer, fileName, rowsCount: snapshot.programRows.length + 5,
        userId: req.user?._id || null, subfolder: "analytics",
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(csv);
    } catch (err) {
      console.error("EXPORT ANALYTICS ERROR:", err);
      return res.status(500).send("Failed to export analytics.");
    }
  },

  _test: {
    normalizeAcademicYear, previousAcademicYear, buildWeekBuckets, buildWeeklyCountFast,
    buildWeeklySumFast, buildSchoolUnitFilter, studentScopeStages, buildAnalyticsSnapshot,
  },
};
