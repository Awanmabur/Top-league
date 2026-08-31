const mongoose = require("mongoose");
const { escapeRegex } = require("../../../services/tenant/financeService");
const reportCtl = require("../../../services/tenant/reportControlService");
const { storeCsvArtifact } = require("../../../services/tenant/reportArtifactService");
const { uploadBuffer, safeDestroy } = require("../../../utils/cloudinaryUpload");
const {
  accountSnapshot,
  activeInvoice,
  completedPayment,
  liveInvoiceStatus,
  programName,
  studentProgramId,
  studentAcademicLabel,
} = require("../../../services/tenant/financeVisibilityService");

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const moneyNum = (v) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

function schoolLevelLabel(v) {
  const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
  return map[String(v || "").toLowerCase()] || "-";
}
function getStudentName(student) {
  return student?.fullName || [student?.firstName, student?.middleName, student?.lastName].filter(Boolean).join(" ") || student?.regNo || "-";
}
function getStudentRegNo(student) { return student?.regNo || student?.admissionNumber || student?.studentNo || "-"; }
function programLabel(program) {
  const name = programName(program) || "-";
  const code = str(program?.code, 40);
  return code && code !== name ? `${code} - ${name}` : name;
}
function buildFilters(query = {}) {
  return { clean: {
    q: str(query.q, 120), student: str(query.student || "all", 80), program: str(query.program || "all", 80),
    schoolLevel: str(query.schoolLevel || "all", 30).toLowerCase(), classLevel: str(query.classLevel || "all", 20).toUpperCase(),
    term: str(query.term || "all", 20), academicYear: str(query.academicYear || "all", 30), view: str(query.view || "list", 20) || "list",
  } };
}
function invoiceDescription(inv) {
  const item = Array.isArray(inv?.items) && inv.items[0] ? inv.items[0] : null;
  return [item?.title || inv?.reference || "Invoice charge", inv?.academicYear, inv?.term].map((x) => str(x, 200)).filter(Boolean).join(" - ");
}
function paymentDescription(payment) {
  return [payment?.method, payment?.reference, payment?.notes].map((x) => str(x, 200)).filter(Boolean).join(" - ") || "Payment";
}

function buildStatementForStudent(student, invoices = [], payments = []) {
  const studentId = String(student._id);
  const studentInvoices = invoices.filter((invoice) => String(invoice.studentId?._id || invoice.studentId || "") === studentId);
  const studentPayments = payments.filter((payment) => String(payment.studentId?._id || payment.studentId || "") === studentId);
  const snapshot = accountSnapshot(studentInvoices, studentPayments);
  const academicLabel = studentAcademicLabel(student);
  const canonicalProgramId = studentProgramId(student);
  const movements = [];

  studentInvoices.filter(activeInvoice).forEach((invoice) => {
    const program = invoice.programId || student.programId || null;
    movements.push({
      type: "Invoice", ref: invoice.invoiceNumber || "-", date: new Date(invoice.issueDate || invoice.createdAt || 0),
      rawDate: invoice.issueDate || invoice.createdAt ? new Date(invoice.issueDate || invoice.createdAt).toISOString().slice(0, 10) : "",
      description: invoiceDescription(invoice), programId: String(program?._id || program || canonicalProgramId || ""),
      programName: programName(program) || academicLabel, schoolLevel: student.schoolLevel || "", classLevel: student.classLevel || "",
      term: invoice.term || student.term || "", academicYear: invoice.academicYear || student.academicYear || "",
      debit: moneyNum(invoice.totalAmount), credit: 0, status: liveInvoiceStatus(invoice),
    });
  });
  studentPayments.filter(completedPayment).forEach((payment) => {
    const program = payment.programId || student.programId || null;
    movements.push({
      type: "Payment", ref: payment.receiptNumber || "-", date: new Date(payment.paymentDate || payment.createdAt || 0),
      rawDate: payment.paymentDate || payment.createdAt ? new Date(payment.paymentDate || payment.createdAt).toISOString().slice(0, 10) : "",
      description: paymentDescription(payment), programId: String(program?._id || program || canonicalProgramId || ""),
      programName: programName(program) || academicLabel, schoolLevel: student.schoolLevel || "", classLevel: student.classLevel || "",
      term: payment.term || student.term || "", academicYear: payment.academicYear || student.academicYear || "",
      debit: 0, credit: moneyNum(payment.amount), status: "Completed",
    });
  });
  movements.sort((a, b) => a.date.getTime() - b.date.getTime());
  let runningBalance = 0;
  const ledger = movements.map((movement) => ({ ...movement, runningBalance: (runningBalance += moneyNum(movement.debit) - moneyNum(movement.credit)) }));
  const programIds = [...new Set([canonicalProgramId, ...ledger.map((row) => row.programId)].filter(Boolean))];

  return {
    id: studentId, studentName: getStudentName(student), admissionNumber: getStudentRegNo(student), regNo: getStudentRegNo(student),
    schoolLevel: student.schoolLevel || "", classLevel: student.classLevel || "", term: Number(student.term || 1), academicYear: student.academicYear || "",
    status: student.status || "active", holdType: student.holdType || "", holdReason: student.holdReason || "",
    subjectNames: [], programIds, programName: academicLabel,
    totalInvoiced: snapshot.billed, totalPaid: snapshot.paid, balance: snapshot.balance, amountDue: snapshot.balance,
    creditBalance: snapshot.credit, invoiceOutstanding: snapshot.invoiceOutstanding, unallocatedCredit: snapshot.unallocatedCredit,
    invoiceCount: snapshot.invoiceCount, paymentCount: snapshot.paymentCount, ledger,
  };
}

async function buildStatementsSnapshot(req) {
  const { Student, Invoice, Payment, Program } = req.models || {};
  if (!Student || !Invoice || !Payment || !Program) throw new Error("Student statements are unavailable.");
  const { clean } = buildFilters(req.query);
  const [studentDocs, invoiceDocs, paymentDocs, programDocs] = await Promise.all([
    Student.find({ isDeleted: { $ne: true } })
      .select("firstName middleName lastName fullName regNo studentNo schoolLevel classLevel className section stream term academicYear programId status holdType holdReason createdAt")
      .populate("programId", "title shortTitle name code").sort({ createdAt: -1 }).lean(),
    Invoice.find({ isDeleted: { $ne: true } }).populate("studentId", "firstName middleName lastName fullName regNo schoolLevel classLevel className section stream term academicYear programId")
      .populate("programId", "title shortTitle name code").sort({ issueDate: 1, createdAt: 1 }).lean(),
    Payment.find({ isDeleted: { $ne: true } }).populate("studentId", "firstName middleName lastName fullName regNo schoolLevel classLevel className section stream term academicYear programId")
      .populate("programId", "title shortTitle name code").sort({ paymentDate: 1, createdAt: 1 }).lean(),
    Program.find({ isDeleted: { $ne: true } }).select("title shortTitle name code").sort({ name: 1, title: 1, code: 1 }).lean(),
  ]);

  let filteredStudents = studentDocs || [];
  if (clean.student !== "all" && isValidId(clean.student)) filteredStudents = filteredStudents.filter((s) => String(s._id) === clean.student);
  if (clean.program !== "all" && isValidId(clean.program)) filteredStudents = filteredStudents.filter((s) => studentProgramId(s) === clean.program);
  if (clean.schoolLevel !== "all") filteredStudents = filteredStudents.filter((s) => String(s.schoolLevel || "").toLowerCase() === clean.schoolLevel);
  if (clean.classLevel !== "all") filteredStudents = filteredStudents.filter((s) => String(s.classLevel || "").toUpperCase() === clean.classLevel);
  if (clean.term !== "all") filteredStudents = filteredStudents.filter((s) => String(s.term || "") === clean.term);
  if (clean.academicYear !== "all") filteredStudents = filteredStudents.filter((s) => String(s.academicYear || "") === clean.academicYear);
  if (clean.q) {
    const regex = new RegExp(escapeRegex(clean.q), "i");
    filteredStudents = filteredStudents.filter((s) => regex.test([
      getStudentName(s), getStudentRegNo(s), schoolLevelLabel(s.schoolLevel), s.classLevel || "", s.className || "", s.section || "", s.stream || "", studentAcademicLabel(s),
    ].join(" ")));
  }

  const statements = filteredStudents.map((student) => buildStatementForStudent(student, invoiceDocs, paymentDocs));
  const totals = statements.reduce((acc, s) => {
    acc.students += 1; acc.invoiced += moneyNum(s.totalInvoiced); acc.paid += moneyNum(s.totalPaid); acc.balance += moneyNum(s.balance);
    acc.credit += moneyNum(s.creditBalance); acc.invoices += Number(s.invoiceCount || 0); acc.payments += Number(s.paymentCount || 0); return acc;
  }, { students: 0, invoiced: 0, paid: 0, balance: 0, credit: 0, invoices: 0, payments: 0 });
  const academicYears = [...new Set((studentDocs || []).map((s) => str(s.academicYear, 30)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return {
    statements, totals, query: clean, academicYears,
    students: (studentDocs || []).map((s) => ({ id: String(s._id), name: getStudentName(s), regNo: getStudentRegNo(s) })),
    programs: (programDocs || []).map((p) => ({ id: String(p._id), name: programLabel(p) })),
  };
}

function statementsCsv(snapshot) {
  const rows = [["Student", "Admission No", "Program / Class", "Invoices", "Completed Payments", "Billed", "Received", "Invoice Outstanding", "Unallocated Credit", "Net Balance", "Account Credit"]];
  for (const statement of snapshot.statements) {
    rows.push([
      statement.studentName, statement.admissionNumber, statement.programName, statement.invoiceCount, statement.paymentCount,
      statement.totalInvoiced, statement.totalPaid, statement.invoiceOutstanding, statement.unallocatedCredit, statement.balance, statement.creditBalance,
    ]);
    if (snapshot.statements.length === 1) {
      rows.push([]);
      rows.push(["Date", "Type", "Reference", "Description", "Program / Class", "Debit", "Credit", "Running Balance", "Status"]);
      rows.push(...statement.ledger.map((row) => [row.rawDate, row.type, row.ref, row.description, row.programName, row.debit, row.credit, row.runningBalance, row.status]));
    }
  }
  return Buffer.from(rows.map((row) => row.map(reportCtl.csvCell).join(",")).join("\n"), "utf8");
}

module.exports = {
  index: async (req, res) => {
    try {
      const snapshot = await buildStatementsSnapshot(req);
      res.set("Cache-Control", "private, no-store");
      return res.render("tenant/finance/student-statements", {
        tenant: req.tenant || null, csrfToken: req.csrfToken?.() || null,
        statements: snapshot.statements, students: snapshot.students, programs: snapshot.programs,
        academicYears: snapshot.academicYears, totals: snapshot.totals, query: snapshot.query,
        messages: { success: req.flash ? req.flash("success") : [], error: req.flash ? req.flash("error") : [] },
      });
    } catch (error) {
      console.error("studentStatementsController.index error:", error);
      return res.status(500).render("platform/public/500", { tenant: req.tenant || null, message: "Failed to load student statements." });
    }
  },

  exportCsv: async (req, res) => {
    try {
      const snapshot = await buildStatementsSnapshot(req);
      const buffer = statementsCsv(snapshot);
      const suffix = snapshot.statements.length === 1 ? String(snapshot.statements[0].admissionNumber || snapshot.statements[0].id).replace(/[^A-Za-z0-9_-]+/g, "-") : "filtered";
      const fileName = `student-statements-${suffix}-${Date.now()}.csv`;
      await storeCsvArtifact({
        ReportExport: req.models?.ReportExport, uploadBuffer, safeDestroy,
        tenantCode: req.tenant?.code || req.tenant?._id || "tenant",
        type: "students_outstanding", source: "export",
        filters: { ...snapshot.query, reportSurface: "student_statements" },
        buffer, fileName,
        rowsCount: snapshot.statements.length === 1 ? snapshot.statements[0].ledger.length + 3 : snapshot.statements.length + 1,
        userId: req.user?._id || null, subfolder: "student-statements",
      });
      res.set("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(buffer.toString("utf8"));
    } catch (error) {
      console.error("studentStatementsController.exportCsv error:", error);
      return res.status(500).send("Failed to export student statements.");
    }
  },

  _private: { buildFilters, buildStatementForStudent, buildStatementsSnapshot, statementsCsv, programLabel },
};
