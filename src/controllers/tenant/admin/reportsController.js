const mongoose = require("mongoose");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");

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

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function countCsvRows(buffer) {
  const text = String(buffer || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((x) => x.trim() !== "");
  if (!lines.length) return 0;
  return Math.max(0, lines.length - 1);
}

function buildDateMatch(filters, field = "createdAt") {
  const m = {};
  const from = asDate(filters.from);
  const to = asDate(filters.to);

  if (from || to) {
    m[field] = {};
    if (from) m[field].$gte = startOfDay(from);
    if (to) m[field].$lte = endOfDay(to);
  }

  return m;
}

async function getPrograms(req) {
  const Program = req.models?.Program;
  if (!Program) return [];

  return Program.find({ isDeleted: { $ne: true } })
    .select("name title code")
    .sort({ name: 1, title: 1 })
    .lean();
}

function buildFiltersFromQuery(req) {
  const type = safeStr(req.query.type || "finance_summary");
  const from = safeStr(req.query.from);
  const to = safeStr(req.query.to);
  const academicYear = safeStr(req.query.academicYear);
  const semester = safeStr(req.query.semester);
  const status = safeStr(req.query.status);
  const program = safeStr(req.query.program);

  return {
    type: ALLOWED_REPORT_TYPES.has(type) ? type : "finance_summary",
    from,
    to,
    academicYear: academicYear.slice(0, 20),
    semester: /^\d+$/.test(semester) ? semester : "",
    status: ALLOWED_STATUSES.has(status) ? status : "",
    program: mongoose.Types.ObjectId.isValid(program) ? program : "",
  };
}

// ---------- report builders ----------
async function reportFinanceSummary(req, filters) {
  const { Invoice, Payment } = req.models || {};
  const matchSoft = { isDeleted: { $ne: true } };
  const invoiceDateMatch = buildDateMatch(filters, "createdAt");
  const paymentDateMatch = buildDateMatch(filters, "createdAt");

  let invoicesIssued = 0;
  let invoicesAmount = 0;
  let invoicesPaid = 0;
  let paymentsCount = 0;
  let paymentsAmount = 0;
  let outstanding = 0;

  const jobs = [];

  if (Invoice) {
    jobs.push(
      Invoice.aggregate([
        { $match: { ...matchSoft, ...invoiceDateMatch } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            total: { $sum: "$amount" },
            paid: { $sum: "$amountPaid" },
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
        { $match: { ...matchSoft, status: { $in: ["unpaid", "partial"] } } },
        {
          $group: {
            _id: null,
            outstanding: {
              $sum: { $max: [0, { $subtract: ["$amount", "$amountPaid"] }] },
            },
          },
        },
      ]).then((agg) => {
        outstanding = agg[0] ? safeNum(agg[0].outstanding, 0) : 0;
      })
    );
  }

  if (Payment) {
    jobs.push(
      Payment.aggregate([
        { $match: { ...matchSoft, ...paymentDateMatch } },
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
  const { Invoice, Student, Program } = req.models || {};
  if (!Invoice) return { title: "Invoices Report", columns: [], rows: [], kpis: null };

  const q = {
    isDeleted: { $ne: true },
    ...buildDateMatch(filters, "createdAt"),
  };

  if (filters.status) q.status = filters.status;
  if (filters.academicYear) q.academicYear = filters.academicYear;
  if (filters.semester) q.semester = safeNum(filters.semester, 0);

  const invoices = await Invoice.find(q)
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  const studentIds = Array.from(new Set(
    invoices.map((x) => x.studentId).filter(Boolean).map(String)
  ));

  const students = Student
    ? await Student.find({ _id: { $in: studentIds }, isDeleted: { $ne: true } })
        .select("fullName firstName lastName regNo program")
        .lean()
    : [];

  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  const programIds = Array.from(new Set(
    students.map((s) => s.program).filter(Boolean).map(String)
  ));

  const programDocs = Program
    ? await Program.find({ _id: { $in: programIds }, isDeleted: { $ne: true } })
        .select("code name title")
        .lean()
    : [];

  const programMap = new Map(programDocs.map((p) => [String(p._id), p]));

  let rows = invoices.map((inv) => {
    const st = inv.studentId ? studentMap.get(String(inv.studentId)) : null;
    const pr = st?.program ? programMap.get(String(st.program)) : null;

    const studentLabel = st
      ? ((st.fullName || [st.firstName, st.lastName].filter(Boolean).join(" ").trim()) + (st.regNo ? ` • ${st.regNo}` : ""))
      : "-";

    const programLabel = pr
      ? ((pr.code ? pr.code + " — " : "") + (pr.name || pr.title || "Program"))
      : "-";

    const amount = safeNum(inv.amount, 0);
    const paid = safeNum(inv.amountPaid, 0);
    const outstanding = Math.max(0, amount - paid);

    return {
      invoiceNumber: inv.invoiceNumber || "-",
      description: inv.description || "",
      student: studentLabel,
      program: programLabel,
      academicYear: inv.academicYear || "",
      semester: inv.semester || "",
      amount,
      paid,
      outstanding,
      status: inv.status || "unpaid",
      createdAt: inv.createdAt ? new Date(inv.createdAt).toLocaleString() : "",
      _href: `/admin/invoices/${inv._id}`,
      _programId: st?.program ? String(st.program) : "",
    };
  });

  if (filters.program) {
    rows = rows.filter((r) => r._programId === filters.program);
  }

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
      { key: "semester", label: "Sem" },
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
  const { Payment, Student, Invoice, Program } = req.models || {};
  if (!Payment) return { title: "Payments Report", columns: [], rows: [], kpis: null };

  const q = {
    isDeleted: { $ne: true },
    ...buildDateMatch(filters, "createdAt"),
  };

  const payments = await Payment.find(q)
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  const studentIds = Array.from(new Set(
    payments.map((p) => p.studentId).filter(Boolean).map(String)
  ));
  const invoiceIds = Array.from(new Set(
    payments.map((p) => p.invoiceId).filter(Boolean).map(String)
  ));

  const students = Student
    ? await Student.find({ _id: { $in: studentIds }, isDeleted: { $ne: true } })
        .select("fullName firstName lastName regNo program")
        .lean()
    : [];

  const invoices = Invoice
    ? await Invoice.find({ _id: { $in: invoiceIds }, isDeleted: { $ne: true } })
        .select("invoiceNumber")
        .lean()
    : [];

  const studentMap = new Map(students.map((s) => [String(s._id), s]));
  const invoiceMap = new Map(invoices.map((i) => [String(i._id), i]));

  const programIds = Array.from(new Set(
    students.map((s) => s.program).filter(Boolean).map(String)
  ));

  const programDocs = Program
    ? await Program.find({ _id: { $in: programIds }, isDeleted: { $ne: true } })
        .select("code name title")
        .lean()
    : [];

  const programMap = new Map(programDocs.map((p) => [String(p._id), p]));

  let rows = payments.map((p) => {
    const st = p.studentId ? studentMap.get(String(p.studentId)) : null;
    const inv = p.invoiceId ? invoiceMap.get(String(p.invoiceId)) : null;
    const pr = st?.program ? programMap.get(String(st.program)) : null;

    const studentLabel = st
      ? ((st.fullName || [st.firstName, st.lastName].filter(Boolean).join(" ").trim()) + (st.regNo ? ` • ${st.regNo}` : ""))
      : "-";

    return {
      receiptNumber: p.receiptNumber || "-",
      invoiceNumber: inv ? (inv.invoiceNumber || "-") : "-",
      student: studentLabel,
      program: pr ? ((pr.code ? pr.code + " — " : "") + (pr.name || pr.title || "Program")) : "-",
      amount: safeNum(p.amount, 0),
      method: p.method || "-",
      reference: p.reference || "",
      createdAt: p.createdAt ? new Date(p.createdAt).toLocaleString() : "",
      _programId: st?.program ? String(st.program) : "",
    };
  });

  if (filters.program) {
    rows = rows.filter((r) => r._programId === filters.program);
  }

  const total = rows.reduce((s, r) => s + safeNum(r.amount), 0);

  return {
    title: "Payments Report",
    columns: [
      { key: "receiptNumber", label: "Receipt" },
      { key: "invoiceNumber", label: "Invoice" },
      { key: "student", label: "Student" },
      { key: "program", label: "Program" },
      { key: "amount", label: "Amount", align: "right", money: true },
      { key: "method", label: "Method" },
      { key: "reference", label: "Reference" },
      { key: "createdAt", label: "Created" },
    ],
    rows,
    kpis: {
      a: { label: "Total Collected", value: total, prefix: "UGX " },
      b: { label: "Payments", value: rows.length, prefix: "" },
      c: { label: "Avg Payment", value: rows.length ? Math.round(total / rows.length) : 0, prefix: "UGX " },
      d: { label: "Records", value: rows.length, prefix: "" },
    },
  };
}

async function reportAdmissions(req, filters) {
  const { Applicant } = req.models || {};
  if (!Applicant) return { title: "Admissions Report", columns: [], rows: [], kpis: null };

  const q = {
    isDeleted: { $ne: true },
    ...buildDateMatch(filters, "createdAt"),
  };

  if (filters.status) q.status = filters.status;
  if (filters.program) q.program1 = filters.program;

  const apps = await Applicant.find(q)
    .populate("program1", "code name title")
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  const rows = apps.map((a) => ({
    applicationId: a.applicationId || "-",
    name: (a.fullName || [a.firstName, a.lastName].filter(Boolean).join(" ").trim()) || "-",
    program: a.program1 ? ((a.program1.code ? a.program1.code + " — " : "") + (a.program1.name || a.program1.title || "Program")) : "-",
    status: a.status || "-",
    email: a.email || "",
    phone: a.phone || "",
    createdAt: a.createdAt ? new Date(a.createdAt).toLocaleString() : "",
    _href: `/admin/admissions/applicants/${a._id}`,
  }));

  const total = rows.length;
  const accepted = rows.filter((r) => r.status === "accepted").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const underReview = rows.filter((r) => r.status === "under_review").length;

  return {
    title: "Admissions Report",
    columns: [
      { key: "applicationId", label: "Application ID" },
      { key: "name", label: "Name" },
      { key: "program", label: "Program" },
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
  const { Student, Invoice, Program } = req.models || {};
  if (!Student || !Invoice) return { title: "Students Outstanding", columns: [], rows: [], kpis: null };

  const agg = await Invoice.aggregate([
    { $match: { isDeleted: { $ne: true }, status: { $in: ["unpaid", "partial"] } } },
    {
      $group: {
        _id: "$studentId",
        outstanding: { $sum: { $max: [0, { $subtract: ["$amount", "$amountPaid"] }] } },
      },
    },
    { $sort: { outstanding: -1 } },
    { $limit: 300 },
  ]);

  const studentIds = agg.map((x) => x._id).filter(Boolean);

  const students = await Student.find({
    _id: { $in: studentIds },
    isDeleted: { $ne: true },
  })
    .select("fullName firstName lastName regNo program status")
    .lean();

  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  const programIds = Array.from(new Set(
    students.map((s) => s.program).filter(Boolean).map(String)
  ));

  const programDocs = Program
    ? await Program.find({ _id: { $in: programIds }, isDeleted: { $ne: true } })
        .select("code name title")
        .lean()
    : [];

  const programMap = new Map(programDocs.map((p) => [String(p._id), p]));

  let rows = agg.map((x) => {
    const st = studentMap.get(String(x._id));
    const pr = st?.program ? programMap.get(String(st.program)) : null;

    return {
      student: st
        ? ((st.fullName || [st.firstName, st.lastName].filter(Boolean).join(" ").trim()) + (st.regNo ? ` • ${st.regNo}` : ""))
        : "-",
      program: pr ? ((pr.code ? pr.code + " — " : "") + (pr.name || pr.title || "Program")) : "-",
      status: st?.status || "",
      outstanding: safeNum(x.outstanding, 0),
      _programId: st?.program ? String(st.program) : "",
    };
  });

  if (filters.program) {
    rows = rows.filter((r) => r._programId === filters.program);
  }

  const totalOutstanding = rows.reduce((s, r) => s + safeNum(r.outstanding), 0);

  return {
    title: "Students Outstanding",
    columns: [
      { key: "student", label: "Student" },
      { key: "program", label: "Program" },
      { key: "status", label: "Status" },
      { key: "outstanding", label: "Outstanding", align: "right", money: true },
    ],
    rows,
    kpis: {
      a: { label: "Outstanding Total", value: totalOutstanding, prefix: "UGX " },
      b: { label: "Students", value: rows.length, prefix: "" },
      c: { label: "Top List", value: 300, prefix: "" },
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

      const [programs, report, exportsList] = await Promise.all([
        getPrograms(req),
        buildReport(req, filters),
        ReportExport
          ? ReportExport.find({ isDeleted: { $ne: true } })
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

      const header = columns.map((c) => csvEscape(c.label)).join(",");
      const lines = [header];

      for (const row of rows) {
        lines.push(columns.map((c) => csvEscape(row[c.key])).join(","));
      }

      const csv = lines.join("\n");
      const csvBuf = Buffer.from(csv, "utf8");

      const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
      const folder = `${folderBase}/${req.tenant?.code || req.tenant?._id || "tenant"}/reports`;
      const fileName = `report-${filters.type}-${Date.now()}.csv`;

      let upload = null;

      if (typeof uploadBuffer === "function") {
        upload = await uploadBuffer({
          buffer: csvBuf,
          mimetype: "text/csv",
          originalname: fileName,
          size: csvBuf.length,
        }, folder, { resource_type: "raw" });
      }

      if (ReportExport) {
        await ReportExport.create({
          type: filters.type,
          source: "export",
          format: "csv",
          filters,
          rowsCount: rows.length,
          byteSize: csvBuf.length,
          fileUrl: upload?.secure_url || "",
          filePublicId: upload?.public_id || "",
          fileResourceType: upload?.resource_type || "raw",
          status: "ready",
          createdBy: req.user?._id || null,
        });
      }

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
      if (rowsCount < 1) {
        req.flash?.("error", "CSV file is empty.");
        return res.redirect("/admin/reports");
      }

      const folderBase = process.env.CLOUDINARY_FOLDER || "classic-academy";
      const folder = `${folderBase}/${req.tenant?.code || req.tenant?._id || "tenant"}/reports/imports`;

      let upload = null;
      if (typeof uploadBuffer === "function") {
        upload = await uploadBuffer({
          buffer: req.file.buffer,
          mimetype: "text/csv",
          originalname,
          size: req.file.size || req.file.buffer.length,
        }, folder, { resource_type: "raw" });
      }

      if (ReportExport) {
        await ReportExport.create({
          type,
          source: "import",
          format: "csv",
          filters: {},
          rowsCount,
          byteSize: req.file.size || req.file.buffer.length,
          fileUrl: upload?.secure_url || "",
          filePublicId: upload?.public_id || "",
          fileResourceType: upload?.resource_type || "raw",
          originalFileName: originalname,
          status: "ready",
          createdBy: req.user?._id || null,
        });
      }

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
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(404).send("Invalid ID");
      }

      const ex = await ReportExport.findOne({
        _id: id,
        isDeleted: { $ne: true },
      }).lean();

      if (!ex) return res.status(404).send("Export not found");
      if (ex.fileUrl) return res.redirect(ex.fileUrl);

      return res.status(404).send("Export file missing");
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

      const ex = await ReportExport.findOne({
        _id: id,
        isDeleted: { $ne: true },
      });

      if (!ex) {
        req.flash?.("error", "Export not found.");
        return res.redirect("/admin/reports");
      }

      if (ex.filePublicId) {
        await safeDestroy(ex.filePublicId, ex.fileResourceType || "raw");
      }

      ex.isDeleted = true;
      ex.deletedAt = new Date();
      ex.updatedBy = req.user?._id || null;
      await ex.save();

      req.flash?.("success", "Report file deleted.");
      return res.redirect("/admin/reports");
    } catch (err) {
      console.error("DELETE EXPORT ERROR:", err);
      req.flash?.("error", "Failed to delete report file.");
      return res.redirect("/admin/reports");
    }
  },
};