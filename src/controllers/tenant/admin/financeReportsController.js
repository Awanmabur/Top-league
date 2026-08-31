const mongoose = require("mongoose");
const { escapeRegex } = require("../../../services/tenant/financeService");
const reportCtl = require("../../../services/tenant/reportControlService");
const { storeCsvArtifact } = require("../../../services/tenant/reportArtifactService");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const {
  idOf,
  programName,
  studentProgramId,
  studentAcademicLabel,
  accountSnapshot,
  liveInvoiceStatus,
  resolvePeriodRange,
  dateInRange,
} = require("../../../services/tenant/financeVisibilityService");

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const moneyNum = (v) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

function getStudentName(st) {
  if (!st) return "—";
  return st.fullName || [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") || st.regNo || st.admissionNumber || "—";
}
function getStudentRegNo(st) { return st?.regNo || st?.admissionNumber || st?.studentNo || ""; }
function getStudentId(doc) { return idOf(doc?.studentId); }
function getRecordProgramId(doc, studentsById) {
  const direct = idOf(doc?.programId);
  if (direct) return direct;
  const sid = getStudentId(doc);
  return sid ? studentProgramId(studentsById.get(sid)) : "";
}
function getRecordProgram(doc, programsMap, studentsById) {
  const direct = doc?.programId;
  if (direct && typeof direct === "object" && direct._id) return direct;
  const pid = getRecordProgramId(doc, studentsById);
  return programsMap.get(pid) || studentsById.get(getStudentId(doc))?.programId || null;
}
function buildFilters(query = {}) {
  return { clean: {
    q: str(query.q, 120),
    period: str(query.period || "this_month", 30) || "this_month",
    program: str(query.program || "all", 80) || "all",
    student: str(query.student || "all", 80) || "all",
    view: str(query.view || "overview", 20) || "overview",
  } };
}

async function buildFinanceReportSnapshot(req) {
  const { Invoice, Payment, Expense, Scholarship, Student, Program } = req.models || {};
  if (!Invoice || !Payment || !Student || !Program) throw new Error("Finance reporting models are unavailable.");

  const { clean } = buildFilters(req.query);
  const range = resolvePeriodRange(clean.period, req.tenant?.timezone || "UTC");

  const [invoiceDocs, paymentDocs, expenseDocs, scholarshipDocs, studentDocs, programDocs] = await Promise.all([
    Invoice.find({ isDeleted: { $ne: true } })
      .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo studentNo programId className classLevel section stream")
      .populate("programId", "title shortTitle name code")
      .sort({ issueDate: -1, createdAt: -1 }).lean(),
    Payment.find({ isDeleted: { $ne: true } })
      .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo studentNo programId className classLevel section stream")
      .populate("invoiceId", "invoiceNumber")
      .populate("programId", "title shortTitle name code")
      .sort({ paymentDate: -1, createdAt: -1 }).lean(),
    Expense ? Expense.find({ isDeleted: { $ne: true } }).sort({ expenseDate: -1, createdAt: -1 }).lean() : [],
    Scholarship ? Scholarship.find({ isDeleted: { $ne: true } })
      .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo studentNo programId")
      .populate("programId", "title shortTitle name code")
      .sort({ createdAt: -1 }).lean() : [],
    Student.find({ isDeleted: { $ne: true } })
      .select("firstName middleName lastName fullName admissionNumber regNo studentNo programId className classLevel section stream createdAt status")
      .populate("programId", "title shortTitle name code")
      .sort({ createdAt: -1 }).lean(),
    Program.find({ isDeleted: { $ne: true } })
      .select("title shortTitle name code status")
      .sort({ name: 1, title: 1, code: 1 }).lean(),
  ]);

  const programsMap = new Map((programDocs || []).map((p) => [String(p._id), p]));
  const studentsById = new Map((studentDocs || []).map((s) => [String(s._id), s]));

  let invoices = invoiceDocs || [];
  let payments = paymentDocs || [];
  let expenses = expenseDocs || [];
  let scholarships = scholarshipDocs || [];
  let students = studentDocs || [];

  if (clean.program !== "all" && isValidId(clean.program)) {
    invoices = invoices.filter((x) => getRecordProgramId(x, studentsById) === clean.program);
    payments = payments.filter((x) => getRecordProgramId(x, studentsById) === clean.program);
    scholarships = scholarships.filter((x) => getRecordProgramId(x, studentsById) === clean.program);
    students = students.filter((x) => studentProgramId(x) === clean.program);
  }
  if (clean.student !== "all" && isValidId(clean.student)) {
    invoices = invoices.filter((x) => getStudentId(x) === clean.student);
    payments = payments.filter((x) => getStudentId(x) === clean.student);
    scholarships = scholarships.filter((x) => getStudentId(x) === clean.student);
    students = students.filter((x) => String(x._id) === clean.student);
  }
  if (clean.q) {
    const regex = new RegExp(escapeRegex(clean.q), "i");
    invoices = invoices.filter((x) => regex.test([
      x.invoiceNumber, x.reference, x.term, x.academicYear, getStudentName(x.studentId), programName(getRecordProgram(x, programsMap, studentsById)),
    ].filter(Boolean).join(" ")));
    payments = payments.filter((x) => regex.test([
      x.receiptNumber, x.reference, x.method, x.term, x.academicYear, getStudentName(x.studentId), programName(getRecordProgram(x, programsMap, studentsById)),
    ].filter(Boolean).join(" ")));
    expenses = expenses.filter((x) => regex.test([x.expenseNumber, x.voucherNo, x.reference, x.title, x.description, x.category].filter(Boolean).join(" ")));
    scholarships = scholarships.filter((x) => regex.test([
      x.name, x.code, x.sponsor, x.type, getStudentName(x.studentId), programName(getRecordProgram(x, programsMap, studentsById)),
    ].filter(Boolean).join(" ")));
    students = students.filter((x) => regex.test([getStudentName(x), getStudentRegNo(x), studentAcademicLabel(x)].filter(Boolean).join(" ")));
  }

  invoices = invoices.filter((x) => dateInRange(x.issueDate || x.createdAt, range));
  payments = payments.filter((x) => dateInRange(x.paymentDate || x.createdAt, range));
  expenses = expenses.filter((x) => dateInRange(x.expenseDate || x.createdAt, range));
  scholarships = scholarships.filter((x) => dateInRange(x.startDate || x.createdAt, range));

  const balancesByStudent = students.map((student) => {
    const sid = String(student._id);
    const studentInvoices = invoices.filter((x) => getStudentId(x) === sid);
    const studentPayments = payments.filter((x) => getStudentId(x) === sid);
    const snapshot = accountSnapshot(studentInvoices, studentPayments);
    return {
      studentId: sid,
      studentName: getStudentName(student),
      admissionNumber: getStudentRegNo(student),
      programName: studentAcademicLabel(student),
      totalInvoiced: snapshot.billed,
      totalPaid: snapshot.paid,
      invoiceOutstanding: snapshot.invoiceOutstanding,
      unallocatedCredit: snapshot.unallocatedCredit,
      credit: snapshot.credit,
      balance: snapshot.balance,
    };
  }).filter((x) => x.totalInvoiced > 0 || x.totalPaid > 0 || x.balance > 0 || x.credit > 0)
    .sort((a, b) => b.balance - a.balance || b.credit - a.credit);

  const billed = invoices.filter((x) => !["Draft", "Cancelled"].includes(String(x.status || "")))
    .reduce((sum, x) => sum + moneyNum(x.totalAmount), 0);
  const collected = payments.filter((x) => String(x.status || "") === "Completed")
    .reduce((sum, x) => sum + moneyNum(x.amount), 0);
  const expensesTotal = expenses.filter((x) => ["Recorded", "Approved"].includes(String(x.status || "")))
    .reduce((sum, x) => sum + moneyNum(x.amount), 0);
  const outstanding = balancesByStudent.reduce((sum, row) => sum + moneyNum(row.balance), 0);
  const accountCredit = balancesByStudent.reduce((sum, row) => sum + moneyNum(row.credit), 0);
  // Expense has no Student/Program foreign key. Do not combine school-wide
  // expense totals with a student/program-scoped collection figure.
  const netComparable = clean.program === "all" && clean.student === "all";

  const invoiceSummary = {
    total: invoices.length,
    paid: invoices.filter((x) => liveInvoiceStatus(x) === "Paid").length,
    partial: invoices.filter((x) => liveInvoiceStatus(x) === "Partially Paid").length,
    unpaid: invoices.filter((x) => ["Unpaid", "Overdue"].includes(liveInvoiceStatus(x))).length,
    cancelled: invoices.filter((x) => liveInvoiceStatus(x) === "Cancelled").length,
  };
  const paymentSummary = {
    total: payments.length,
    completed: payments.filter((x) => x.status === "Completed").length,
    pending: payments.filter((x) => x.status === "Pending").length,
    voided: payments.filter((x) => x.status === "Voided").length,
    refunded: payments.filter((x) => x.status === "Refunded").length,
  };
  const expenseSummary = {
    total: expenses.length,
    amount: expensesTotal,
    categories: Object.entries(expenses.filter((x) => ["Recorded", "Approved"].includes(String(x.status || "")))
      .reduce((acc, x) => { const key = x.category || "Other"; acc[key] = (acc[key] || 0) + moneyNum(x.amount); return acc; }, {}))
      .map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount),
  };
  const scholarshipSummary = {
    total: scholarships.length,
    active: scholarships.filter((x) => x.status === "Active").length,
    percentage: scholarships.filter((x) => x.type === "Percentage").length,
    fixed: scholarships.filter((x) => x.type === "Fixed Amount").length,
    full: scholarships.filter((x) => x.type === "Full").length,
  };
  const collectionByMethod = Object.entries(payments.filter((x) => x.status === "Completed")
    .reduce((acc, x) => { const key = x.method || "Cash"; acc[key] = (acc[key] || 0) + moneyNum(x.amount); return acc; }, {}))
    .map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);

  const recentActivity = [
    ...invoices.map((x) => ({
      type: "Invoice", ref: x.invoiceNumber || "—",
      description: `${getStudentName(x.studentId)} • ${programName(getRecordProgram(x, programsMap, studentsById)) || "—"}`,
      amount: moneyNum(x.totalAmount), status: liveInvoiceStatus(x),
      rawDate: x.issueDate || x.createdAt ? new Date(x.issueDate || x.createdAt).toISOString().slice(0, 10) : "",
      ts: new Date(x.issueDate || x.createdAt || 0).getTime(),
    })),
    ...payments.map((x) => ({
      type: "Payment", ref: x.receiptNumber || "—",
      description: `${getStudentName(x.studentId)} • ${x.method || "Payment"}`,
      amount: moneyNum(x.amount), status: x.status || "Pending",
      rawDate: x.paymentDate || x.createdAt ? new Date(x.paymentDate || x.createdAt).toISOString().slice(0, 10) : "",
      ts: new Date(x.paymentDate || x.createdAt || 0).getTime(),
    })),
    ...expenses.map((x) => ({
      type: "Expense", ref: x.expenseNumber || x.reference || "—", description: x.title || x.category || "Expense",
      amount: moneyNum(x.amount), status: x.status || "Recorded",
      rawDate: x.expenseDate || x.createdAt ? new Date(x.expenseDate || x.createdAt).toISOString().slice(0, 10) : "",
      ts: new Date(x.expenseDate || x.createdAt || 0).getTime(),
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 30);

  return {
    query: clean,
    reports: {
      overview: { billed, collected, outstanding, accountCredit, expenses: expensesTotal, net: netComparable ? collected - expensesTotal : null, netComparable },
      invoiceSummary, paymentSummary, expenseSummary, scholarshipSummary, collectionByMethod, balancesByStudent, recentActivity,
    },
    programs: (programDocs || []).map((p) => ({ id: String(p._id), name: programName(p) || p.code || "—" })),
    students: (studentDocs || []).map((s) => ({ id: String(s._id), name: getStudentName(s) })),
  };
}

function financeReportCsv(snapshot) {
  const r = snapshot.reports;
  const rows = [
    ["Finance Report", "Value"],
    ["Period", snapshot.query.period],
    ["Billed", r.overview.billed],
    ["Completed payments received", r.overview.collected],
    ["Outstanding after account credit", r.overview.outstanding],
    ["Account credit", r.overview.accountCredit],
    ["Expenses", r.overview.expenses],
    ["Net cash activity", r.overview.netComparable ? r.overview.net : "N/A - expenses are school-wide"],
    [],
    ["Student", "Admission No", "Program / Class", "Billed", "Completed Payments", "Invoice Outstanding", "Unallocated Credit", "Net Balance", "Account Credit"],
    ...r.balancesByStudent.map((row) => [row.studentName, row.admissionNumber, row.programName, row.totalInvoiced, row.totalPaid, row.invoiceOutstanding, row.unallocatedCredit, row.balance, row.credit]),
    [],
    ["Recent Activity Type", "Reference", "Description", "Date", "Amount", "Status"],
    ...r.recentActivity.map((row) => [row.type, row.ref, row.description, row.rawDate, row.amount, row.status]),
  ];
  return Buffer.from(rows.map((row) => row.map(reportCtl.csvCell).join(",")).join("\n"), "utf8");
}

module.exports = {
  index: async (req, res) => {
    try {
      const snapshot = await buildFinanceReportSnapshot(req);
      res.set("Cache-Control", "private, no-store");
      return res.render("tenant/finance/finance-reports", {
        tenant: req.tenant, csrfToken: req.csrfToken?.(), reports: snapshot.reports,
        programs: snapshot.programs, students: snapshot.students, query: snapshot.query,
      });
    } catch (error) {
      console.error("financeReportsController.index error:", error);
      return res.status(500).render("platform/public/500", { tenant: req.tenant, message: error.message || "Failed to load finance reports." });
    }
  },

  exportCsv: async (req, res) => {
    try {
      const snapshot = await buildFinanceReportSnapshot(req);
      const buffer = financeReportCsv(snapshot);
      const fileName = `finance-report-${snapshot.query.period}-${Date.now()}.csv`;
      await storeCsvArtifact({
        ReportExport: req.models?.ReportExport, uploadBuffer, safeDestroy,
        tenantCode: req.tenant?.code || req.tenant?._id || "tenant",
        type: "finance_summary", source: "export",
        filters: { ...snapshot.query, reportSurface: "finance_reports" },
        buffer, fileName,
        rowsCount: snapshot.reports.balancesByStudent.length + snapshot.reports.recentActivity.length + 10,
        userId: req.user?._id || null, subfolder: "finance-reports",
      });
      res.set("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(buffer.toString("utf8"));
    } catch (error) {
      console.error("financeReportsController.exportCsv error:", error);
      return res.status(500).send("Failed to export finance report.");
    }
  },

  _private: { buildFilters, buildFinanceReportSnapshot, financeReportCsv, getRecordProgramId },
};
