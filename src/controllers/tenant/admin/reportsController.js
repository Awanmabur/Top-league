const mongoose = require("mongoose");
const { uploadBuffer, safeDestroy, authenticatedUrl } = require("../../../utils/cloudinaryUpload");
const reportCtl = require("../../../services/tenant/reportControlService");
const { storeCsvArtifact } = require("../../../services/tenant/reportArtifactService");

const ALLOWED_REPORT_TYPES = new Set([
  "finance_summary",
  "invoices",
  "payments",
  "admissions",
  "students_outstanding",
]);

const ALLOWED_STATUSES = new Set([
  "",
  "unpaid",
  "partial",
  "paid",
  "voided",
  "pending",
  "refunded",
  "submitted",
  "under_review",
  "accepted",
  "rejected",
]);

function safeStr(v, def = "") {
  if (v === null || v === undefined) return def;
  return String(v).trim();
}

function safeNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function csvEscape(v) { return reportCtl.csvCell(v); }

function countCsvRows(buffer) { return reportCtl.validateCsvBuffer(buffer, { maxBytes: 2 * 1024 * 1024, maxRows: 5000 }).rowsCount; }

function buildDateMatch(filters, field = "createdAt") { return reportCtl.buildDateMatch(filters.from, filters.to, filters.timezone || "UTC", field); }

async function getPrograms(req) {
  const Program = req.models?.Program;
  if (!Program) return [];
  return Program.find({ isDeleted: { $ne: true }, status: { $ne: "archived" } })
    .select("title shortTitle name code status")
    .sort({ title: 1, shortTitle: 1, name: 1, code: 1 })
    .lean();
}

async function getSections(req) {
  const Section = req.models?.Section;
  if (!Section) return [];
  return Section.find({ status: { $ne: "archived" } })
    .select("code name className classLevel classStream streamName")
    .sort({ classLevel: 1, classStream: 1, name: 1, code: 1 })
    .lean();
}

function buildFiltersFromQuery(req) {
  const type = safeStr(req.query.type || "finance_summary");
  const from = safeStr(req.query.from);
  const to = safeStr(req.query.to);
  const academicYear = safeStr(req.query.academicYear);
  const term = safeStr(req.query.term || req.query.semester);
  const status = safeStr(req.query.status);
  const program = safeStr(req.query.program);
  const section = safeStr(req.query.section);

  return {
    type: ALLOWED_REPORT_TYPES.has(type) ? type : "finance_summary",
    from,
    to,
    academicYear: academicYear.slice(0, 20),
    term: term.slice(0, 20),
    status: ALLOWED_STATUSES.has(status) ? status : "",
    program: mongoose.Types.ObjectId.isValid(program) ? program : "",
    section: mongoose.Types.ObjectId.isValid(section) ? section : "",
    timezone: req.tenant?.timezone || "UTC",
  };
}

function normalizeInvoiceStatusFilter(status) {
  const value = safeStr(status).toLowerCase();
  if (!value) return "";
  if (value === "unpaid") return "Unpaid";
  if (value === "partial") return "Partially Paid";
  if (value === "paid") return "Paid";
  if (value === "voided") return "Cancelled";
  return "";
}

function normalizePaymentStatusFilter(status) {
  const value = safeStr(status).toLowerCase();
  if (!value) return "";
  if (value === "paid") return "Completed";
  if (value === "pending") return "Pending";
  if (value === "voided") return "Voided";
  if (value === "refunded") return "Refunded";
  return "";
}

function getStudentName(student) {
  if (!student) return "-";
  return (
    student.fullName ||
    [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ").trim() ||
    "-"
  );
}

function getStudentRegNo(student) {
  return student?.regNo || student?.admissionNumber || student?.studentNo || "";
}

function getSubjectName(subject) {
  if (!subject) return "-";
  return subject.title || subject.shortTitle || subject.name || subject.code || "-";
}

function getSubjectLabel(subject) {
  if (!subject) return "-";
  const code = safeStr(subject.code);
  const name = getSubjectName(subject);
  return code && code !== name ? `${code} - ${name}` : name;
}

function getStudentAcademicLabel(student) {
  const subjects = Array.isArray(student?.subjects) ? student.subjects : [];
  if (subjects.length) return getSubjectLabel(subjects[0]);

  const parts = [student?.className, student?.section, student?.stream].filter(Boolean);
  return parts.length ? parts.join(" - ") : "-";
}

// ---------- report builders ----------
async function reportFinanceSummary(req, filters) {
  const { Invoice, Payment } = req.models || {};
  const matchSoft = { isDeleted: { $ne: true } };
  const invoiceDateMatch = buildDateMatch(filters, "issueDate");
  const paymentDateMatch = buildDateMatch(filters, "paymentDate");
  const subjectId = mongoose.Types.ObjectId.isValid(filters.program) ? filters.program : "";

  let invoicesIssued = 0;
  let invoicesAmount = 0;
  let invoicesPaid = 0;
  let paymentsCount = 0;
  let paymentsAmount = 0;
  let outstanding = 0;

  const jobs = [];

  if (Invoice) {
    const invoiceMatch = { ...matchSoft, ...invoiceDateMatch };
    if (subjectId) invoiceMatch.programId = new mongoose.Types.ObjectId(subjectId);
    if (filters.academicYear) invoiceMatch.academicYear = filters.academicYear;
    if (filters.term) invoiceMatch.term = filters.term;

    jobs.push(
      Invoice.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: { $ifNull: ["$totalAmount", 0] } },
            paid: { $sum: { $ifNull: ["$paidAmount", 0] } },
          },
        },
      ]).then((agg) => {
        invoicesIssued = agg[0] ? safeNum(agg[0].count, 0) : 0;
        invoicesAmount = agg[0] ? safeNum(agg[0].total, 0) : 0;
        invoicesPaid = agg[0] ? safeNum(agg[0].paid, 0) : 0;
      })
    );

    jobs.push(
      Invoice.aggregate([
        {
          $match: {
            ...invoiceMatch,
            status: { $in: ["Unpaid", "Partially Paid", "Overdue"] },
          },
        },
        {
          $group: {
            _id: null,
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
      ]).then((agg) => {
        outstanding = agg[0] ? safeNum(agg[0].outstanding, 0) : 0;
      })
    );
  }

  if (Payment) {
    const paymentMatch = { ...matchSoft, ...paymentDateMatch, status: "Completed" };
    if (subjectId) paymentMatch.programId = new mongoose.Types.ObjectId(subjectId);
    if (filters.academicYear) paymentMatch.academicYear = filters.academicYear;
    if (filters.term) paymentMatch.term = filters.term;

    jobs.push(
      Payment.aggregate([
        { $match: paymentMatch },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ]).then((agg) => {
        paymentsCount = agg[0] ? safeNum(agg[0].count, 0) : 0;
        paymentsAmount = agg[0] ? safeNum(agg[0].total, 0) : 0;
      })
    );
  }

  await Promise.all(jobs);

  const rows = [
    { metric: "Invoices issued (count)", value: invoicesIssued },
    { metric: "Invoices issued (amount)", value: invoicesAmount },
    { metric: "Invoices paid (amountPaid sum)", value: invoicesPaid },
    { metric: "Payments received (count)", value: paymentsCount },
    { metric: "Payments received (amount)", value: paymentsAmount },
    { metric: "Outstanding balance (unpaid/partial)", value: outstanding },
  ];

  return {
    title: "Finance Summary",
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows,
    kpis: {
      a: { label: "Payments", value: paymentsAmount, prefix: "UGX " },
      b: { label: "Invoices", value: invoicesAmount, prefix: "UGX " },
      c: { label: "Outstanding", value: outstanding, prefix: "UGX " },
      d: { label: "Issued", value: invoicesIssued, prefix: "" },
    },
  };
}

async function reportInvoices(req, filters) {
  const { Invoice } = req.models || {};
  if (!Invoice) return { title: "Invoices Report", columns: [], rows: [], kpis: null };

  const q = {
    isDeleted: { $ne: true },
    ...buildDateMatch(filters, "issueDate"),
  };

  const status = normalizeInvoiceStatusFilter(filters.status);
  if (status) q.status = status;
  if (filters.academicYear) q.academicYear = filters.academicYear;
  if (filters.term) q.term = filters.term;
  if (filters.program) q.programId = filters.program;

  const invoices = await Invoice.find(q)
    .populate("studentId", "fullName firstName middleName lastName regNo admissionNumber studentNo")
    .populate("programId", "title shortTitle name code")
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  const rows = invoices.map((inv) => {
    const student = inv.studentId || null;
    const subject = inv.programId || null;
    const amount = safeNum(inv.totalAmount, 0);
    const paid = safeNum(inv.paidAmount, 0);
    const outstanding = Math.max(0, amount - paid);
    const regNo = getStudentRegNo(student);

    return {
      invoiceNumber: inv.invoiceNumber || "-",
      description: inv.description || "",
      student: student ? `${getStudentName(student)}${regNo ? ` - ${regNo}` : ""}` : "-",
      program: getSubjectLabel(subject),
      academicYear: inv.academicYear || "",
      term: inv.term || "",
      amount,
      paid,
      outstanding,
      status: inv.status || "Unpaid",
      createdAt: inv.createdAt ? new Date(inv.createdAt).toLocaleString() : "",
      _href: `/admin/invoices/${inv._id}`,
      _programId: subject?._id ? String(subject._id) : String(inv.programId || ""),
    };
  });

  const totalAmount = rows.reduce((s, r) => s + safeNum(r.amount), 0);
  const totalPaid = rows.reduce((s, r) => s + safeNum(r.paid), 0);
  const totalOutstanding = rows.reduce((s, r) => s + safeNum(r.outstanding), 0);

  return {
    title: "Invoices Report",
    columns: [
      { key: "invoiceNumber", label: "Invoice" },
      { key: "student", label: "Student" },
      { key: "program", label: "Program" },
      { key: "academicYear", label: "Year" },
      { key: "term", label: "Term" },
      { key: "amount", label: "Amount", align: "right", money: true },
      { key: "paid", label: "Paid", align: "right", money: true },
      { key: "outstanding", label: "Outstanding", align: "right", money: true },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created" },
    ],
    rows,
    kpis: {
      a: { label: "Total Amount", value: totalAmount, prefix: "UGX " },
      b: { label: "Total Paid", value: totalPaid, prefix: "UGX " },
      c: { label: "Outstanding", value: totalOutstanding, prefix: "UGX " },
      d: { label: "Invoices", value: rows.length, prefix: "" },
    },
  };
}

async function reportPayments(req, filters) {
  const { Payment } = req.models || {};
  if (!Payment) return { title: "Payments Report", columns: [], rows: [], kpis: null };

  const q = {
    isDeleted: { $ne: true },
    ...buildDateMatch(filters, "paymentDate"),
  };
  if (filters.academicYear) q.academicYear = filters.academicYear;
  if (filters.term) q.term = filters.term;
  if (filters.program) q.programId = filters.program;
  const paymentStatus = normalizePaymentStatusFilter(filters.status);
  if (paymentStatus) q.status = paymentStatus;

  const payments = await Payment.find(q)
    .populate("studentId", "fullName firstName middleName lastName regNo admissionNumber studentNo")
    .populate("invoiceId", "invoiceNumber")
    .populate("programId", "title shortTitle name code")
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  const rows = payments.map((payment) => {
    const student = payment.studentId || null;
    const invoice = payment.invoiceId || null;
    const subject = payment.programId || null;
    const regNo = getStudentRegNo(student);

    return {
      receiptNumber: payment.receiptNumber || "-",
      invoiceNumber: invoice ? (invoice.invoiceNumber || "-") : "-",
      student: student ? `${getStudentName(student)}${regNo ? ` - ${regNo}` : ""}` : "-",
      program: getSubjectLabel(subject),
      amount: safeNum(payment.amount, 0),
      status: payment.status || "Pending",
      method: payment.method || "-",
      term: payment.term || "",
      academicYear: payment.academicYear || "",
      reference: payment.reference || "",
      createdAt: payment.paymentDate
        ? new Date(payment.paymentDate).toLocaleString()
        : payment.createdAt
          ? new Date(payment.createdAt).toLocaleString()
          : "",
      _programId: subject?._id ? String(subject._id) : String(payment.programId || ""),
    };
  });

  const completedRows = rows.filter((r) => r.status === "Completed");
  const total = completedRows.reduce((sum, r) => sum + safeNum(r.amount), 0);

  return {
    title: "Payments Report",
    columns: [
      { key: "receiptNumber", label: "Receipt" },
      { key: "invoiceNumber", label: "Invoice" },
      { key: "student", label: "Student" },
      { key: "program", label: "Program" },
      { key: "academicYear", label: "Year" },
      { key: "term", label: "Term" },
      { key: "amount", label: "Amount", align: "right", money: true },
      { key: "status", label: "Status" },
      { key: "method", label: "Method" },
      { key: "reference", label: "Reference" },
      { key: "createdAt", label: "Created" },
    ],
    rows,
    kpis: {
      a: { label: "Total Collected", value: total, prefix: "UGX " },
      b: { label: "Completed", value: completedRows.length, prefix: "" },
      c: { label: "Avg Completed", value: completedRows.length ? Math.round(total / completedRows.length) : 0, prefix: "UGX " },
      d: { label: "All Records", value: rows.length, prefix: "" },
    },
  };
}

async function reportAdmissions(req, filters) {
  const { Applicant } = req.models || {};
  if (!Applicant) return { title: "Admissions Report", columns: [], rows: [], kpis: null };

  const q = { isDeleted: { $ne: true }, ...buildDateMatch(filters, "createdAt") };
  if (filters.status) q.status = filters.status;
  if (filters.academicYear) q.academicYear = filters.academicYear;
  if (filters.term) {
    const termNumber = Number(String(filters.term).replace(/\D+/g, ""));
    if (Number.isInteger(termNumber) && termNumber >= 1 && termNumber <= 3) q.term = termNumber;
  }
  if (filters.section) {
    const sectionId = new mongoose.Types.ObjectId(filters.section);
    q.$or = [{ section1: sectionId }, { section1: null, program1: sectionId }];
  }

  const apps = await Applicant.find(q)
    .populate("section1", "code name title classLevel classStream streamName")
    .populate("program1", "code name title classLevel classStream streamName")
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  const rows = apps.map((a) => {
    const section = a.section1 || a.program1 || null;
    return {
      applicationId: a.applicationId || "-",
      name: (a.fullName || [a.firstName, a.lastName].filter(Boolean).join(" ").trim()) || "-",
      program: section ? ((section.code ? section.code + " - " : "") + (section.name || section.title || "Section")) : "-",
      academicYear: a.academicYear || "",
      term: a.term || "",
      status: a.status || "-",
      email: a.email || "",
      phone: a.phone || "",
      createdAt: a.createdAt ? new Date(a.createdAt).toLocaleString() : "",
      _href: `/admin/admissions/applicants/${a._id}`,
    };
  });

  const total = rows.length;
  const accepted = rows.filter((r) => r.status === "accepted").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const underReview = rows.filter((r) => r.status === "under_review").length;
  return {
    title: "Admissions Report",
    columns: [
      { key: "applicationId", label: "Application ID" },
      { key: "name", label: "Name" },
      { key: "program", label: "Section" },
      { key: "academicYear", label: "Year" },
      { key: "term", label: "Term" },
      { key: "status", label: "Status" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "createdAt", label: "Submitted" },
    ],
    rows,
    kpis: {
      a: { label: "Total", value: total, prefix: "" },
      b: { label: "Under Review", value: underReview, prefix: "" },
      c: { label: "Accepted", value: accepted, prefix: "" },
      d: { label: "Rejected", value: rejected, prefix: "" },
    },
  };
}

async function reportStudentsOutstanding(req, filters) {
  const { Invoice, Student, Program } = req.models || {};
  const AcademicProgram = Program || null;
  if (!Invoice) return { title: "Students Outstanding", columns: [], rows: [], kpis: null };

  const invoiceQuery = {
    isDeleted: { $ne: true },
    status: { $in: ["Unpaid", "Partially Paid", "Overdue"] },
  };
  if (filters.academicYear) invoiceQuery.academicYear = filters.academicYear;
  if (filters.term) invoiceQuery.term = filters.term;
  if (filters.program) invoiceQuery.programId = new mongoose.Types.ObjectId(filters.program);

  // Group and sum in the database instead of pulling every open invoice
  // (populated) into Node — this was an unbounded, tenant-wide fetch that
  // got slower every month as invoices accumulated.
  const grouped = await Invoice.aggregate([
    { $match: invoiceQuery },
    {
      $group: {
        _id: "$studentId",
        outstanding: {
          $sum: { $max: [{ $subtract: [{ $ifNull: ["$totalAmount", 0] }, { $ifNull: ["$paidAmount", 0] }] }, 0] },
        },
        programId: { $first: "$programId" },
      },
    },
    { $match: { _id: { $ne: null } } },
    { $sort: { outstanding: -1 } },
    { $limit: 300 },
  ]);

  const studentIds = grouped.map((g) => g._id).filter(Boolean);
  const programIds = grouped.map((g) => g.programId).filter(Boolean);

  const [students, programs] = await Promise.all([
    Student
      ? Student.find({ _id: { $in: studentIds } })
          .select("fullName firstName middleName lastName regNo admissionNumber studentNo status subjects className section stream")
          .lean()
      : [],
    AcademicProgram
      ? AcademicProgram.find({ _id: { $in: programIds } })
          .select("title shortTitle name code")
          .lean()
      : [],
  ]);

  const studentMap = new Map(students.map((s) => [String(s._id), s]));
  const programMap = new Map(programs.map((p) => [String(p._id), p]));

  const rows = grouped
    .map((g) => {
      const student = studentMap.get(String(g._id));
      if (!student) return null;
      const subject = g.programId ? programMap.get(String(g.programId)) : null;
      return {
        student: `${getStudentName(student)}${getStudentRegNo(student) ? ` - ${getStudentRegNo(student)}` : ""}`,
        program: subject ? getSubjectLabel(subject) : getStudentAcademicLabel(student),
        status: student?.status || "",
        outstanding: safeNum(g.outstanding, 0),
        _programId: subject?._id ? String(subject._id) : "",
      };
    })
    .filter(Boolean);

  const totalOutstanding = rows.reduce((s, r) => s + safeNum(r.outstanding), 0);

  return {
    title: "Students Outstanding",
    columns: [
      { key: "student", label: "Student" },
      { key: "program", label: "Program / Class" },
      { key: "status", label: "Status" },
      { key: "outstanding", label: "Outstanding", align: "right", money: true },
    ],
    rows,
    kpis: {
      a: { label: "Outstanding Total", value: totalOutstanding, prefix: "UGX " },
      b: { label: "Students", value: rows.length, prefix: "" },
      c: { label: "Top List", value: rows.length, prefix: "" },
      d: { label: "Action", value: "Follow up", prefix: "" },
    },
  };
}

async function buildReport(req, filters) {
  switch (filters.type) {
    case "invoices":
      return reportInvoices(req, filters);
    case "payments":
      return reportPayments(req, filters);
    case "admissions":
      return reportAdmissions(req, filters);
    case "students_outstanding":
      return reportStudentsOutstanding(req, filters);
    case "finance_summary":
    default:
      return reportFinanceSummary(req, filters);
  }
}

module.exports = {
  reportsPage: async (req, res) => {
    try {
      const { ReportExport } = req.models || {};
      const filters = buildFiltersFromQuery(req);

      const [programs, sections, report, exportsList] = await Promise.all([
        getPrograms(req),
        getSections(req),
        buildReport(req, filters),
        ReportExport
          ? ReportExport.find({ isDeleted: { $ne: true }, migrationQuarantinedAt: null })
              .select("type source filters rowsCount byteSize status createdAt originalFileName fileName revision")
              .sort({ createdAt: -1 })
              .limit(30)
              .lean()
          : Promise.resolve([]),
      ]);

      return res.render("tenant/reports/index", {
        tenant: req.tenant || null,
        csrfToken: res.locals.csrfToken || (req.csrfToken ? req.csrfToken() : ""),
        filters,
        programs,
        sections,
        report,
        exportsList,
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("REPORTS PAGE ERROR:", err);
      req.flash?.("error", "Failed to load reports.");
      return res.status(500).send("Failed to load reports.");
    }
  },

  exportCsv: async (req, res) => {
    try {
      const { ReportExport } = req.models || {};
      const filters = buildFiltersFromQuery(req);
      const report = await buildReport(req, filters);
      const columns = Array.isArray(report.columns) ? report.columns : [];
      const rows = Array.isArray(report.rows) ? report.rows : [];
      const lines = [columns.map((c) => csvEscape(c.label)).join(",")];
      for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c.key])).join(","));
      const csv = lines.join("\n");
      const csvBuf = Buffer.from(csv, "utf8");
      const fileName = `report-${filters.type}-${Date.now()}.csv`;

      await storeCsvArtifact({
        ReportExport, uploadBuffer, safeDestroy,
        tenantCode: req.tenant?.code || req.tenant?._id || "tenant",
        type: filters.type, source: "export", filters, buffer: csvBuf, fileName,
        rowsCount: rows.length, userId: req.user?._id || null,
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(csv);
    } catch (err) {
      console.error("EXPORT CSV ERROR:", err);
      req.flash?.("error", "Failed to export report.");
      return res.status(500).send("Failed to export report.");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { ReportExport } = req.models || {};
      if (!req.file || !req.file.buffer?.length) {
        req.flash?.("error", "Please choose a valid CSV file.");
        return res.redirect("/admin/reports");
      }
      const type = safeStr(req.body.type || "finance_summary");
      if (!ALLOWED_REPORT_TYPES.has(type)) {
        req.flash?.("error", "Invalid import type.");
        return res.redirect("/admin/reports");
      }
      const originalname = safeStr(req.file.originalname || "report-import.csv");
      if (!/\.csv$/i.test(originalname)) {
        req.flash?.("error", "Only CSV files are allowed.");
        return res.redirect("/admin/reports");
      }
      const rowsCount = countCsvRows(req.file.buffer);
      await storeCsvArtifact({
        ReportExport, uploadBuffer, safeDestroy,
        tenantCode: req.tenant?.code || req.tenant?._id || "tenant",
        type, source: "import", filters: {}, buffer: req.file.buffer,
        fileName: reportCtl.safeFilename(originalname, "report-import.csv"), originalFileName: originalname,
        rowsCount, userId: req.user?._id || null, subfolder: "imports",
      });
      req.flash?.("success", "CSV imported into report history.");
      return res.redirect("/admin/reports");
    } catch (err) {
      console.error("IMPORT CSV ERROR:", err);
      req.flash?.("error", err.message || "Failed to import CSV.");
      return res.redirect("/admin/reports");
    }
  },

  downloadExport: async (req, res) => {
    try {
      const { ReportExport } = req.models || {};
      if (!ReportExport) return res.status(404).send("Exports not enabled");
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).send("Invalid ID");
      const ex = await ReportExport.findOne({
        _id: id, isDeleted: { $ne: true }, migrationQuarantinedAt: null, status: "ready",
      }).lean();
      if (!ex) return res.status(404).send("Export not found");
      if (ex.accessType !== "authenticated" || !ex.filePublicId || !/^[a-f0-9]{64}$/i.test(String(ex.checksum || ""))) {
        return res.status(409).send("Export artifact is not trusted for download.");
      }
      const url = authenticatedUrl(ex.filePublicId, ex.fileResourceType || "raw");
      if (!url) return res.status(404).send("Export file missing");
      const timeoutSignal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10000) : undefined;
      const response = await fetch(url, { redirect: "error", signal: timeoutSignal });
      if (!response.ok) return res.status(502).send("Export storage is unavailable.");
      const expectedSize = Math.max(0, Number(ex.byteSize) || 0);
      const maxBytes = expectedSize ? Math.min(Math.max(expectedSize + 65536, 1024 * 1024), 20 * 1024 * 1024) : 20 * 1024 * 1024;
      const buf = await reportCtl.readBoundedResponse(response, maxBytes);
      if (expectedSize && buf.length !== expectedSize) return res.status(409).send("Export artifact size verification failed.");
      if (reportCtl.sha256(buf) !== ex.checksum) return res.status(409).send("Export checksum verification failed.");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${reportCtl.safeFilename(ex.fileName || ex.originalFileName, "report.csv")}"`);
      return res.send(buf);
    } catch (err) {
      console.error("DOWNLOAD EXPORT ERROR:", err);
      return res.status(500).send("Failed to download export.");
    }
  },

  deleteExport: async (req, res) => {
    try {
      const { ReportExport } = req.models || {};
      if (!ReportExport) return res.status(404).send("Exports not enabled");

      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid export id.");
        return res.redirect("/admin/reports");
      }

      const expected = reportCtl.positiveRevision(req.body?.revision);
      if (!expected) {
        req.flash?.("error", "A valid report revision is required.");
        return res.redirect("/admin/reports");
      }
      const ex = await ReportExport.findOne({
        _id: id, revision: expected, isDeleted: { $ne: true }, migrationQuarantinedAt: null,
      });
      if (!ex) {
        req.flash?.("error", "Export not found or changed in another session.");
        return res.redirect("/admin/reports");
      }
      const changed = await ReportExport.updateOne({ _id: ex._id, revision: expected, isDeleted: { $ne: true } }, { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: req.user?._id || null }, $inc: { revision: 1 } });
      if (!(changed.modifiedCount || changed.nModified)) throw new Error("Report export changed in another session.");
      if (ex.filePublicId) {
        const destroyed = await safeDestroy(ex.filePublicId, ex.fileResourceType || "raw");
        if (!destroyed) {
          await ReportExport.updateOne({ _id: ex._id, revision: expected + 1, isDeleted: true }, { $set: { isDeleted: false, deletedAt: null, updatedBy: req.user?._id || null }, $inc: { revision: 1 } }).catch(() => {});
          throw new Error("Report storage deletion failed; history entry was retained.");
        }
      }

      req.flash?.("success", "Report file deleted.");
      return res.redirect("/admin/reports");
    } catch (err) {
      console.error("DELETE EXPORT ERROR:", err);
      req.flash?.("error", "Failed to delete report file.");
      return res.redirect("/admin/reports");
    }
  },
};
