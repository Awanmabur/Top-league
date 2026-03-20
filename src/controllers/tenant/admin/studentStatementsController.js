const mongoose = require("mongoose");

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

function getStudentName(st) {
  if (!st) return "—";
  return (
    st.fullName ||
    [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") ||
    st.name ||
    st.admissionNumber ||
    "—"
  );
}

function getProgramName(p) {
  if (!p) return "—";
  return p.name || p.title || p.programName || p.code || "—";
}

function moneyNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function invoiceStatus(inv) {
  if (!inv) return "Unpaid";
  if (inv.status === "Cancelled") return "Cancelled";
  if (inv.status === "Draft") return "Draft";

  const total = moneyNum(inv.totalAmount);
  const paid = moneyNum(inv.paidAmount);
  const balance =
    inv.balance !== undefined && inv.balance !== null
      ? moneyNum(inv.balance)
      : Math.max(0, total - paid);

  if (balance <= 0 && total > 0) return "Paid";
  if (paid > 0 && balance > 0) return "Partially Paid";
  return "Unpaid";
}

function paymentStatus(p) {
  return p?.status || "Completed";
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const student = str(query.student || "all");
  const program = str(query.program || "all");
  const view = str(query.view || "list") || "list";

  return {
    clean: { q, student, program, view },
  };
}

function hasPath(Model, pathName) {
  return Boolean(Model?.schema?.path(pathName));
}

function getRefValue(doc, fieldName) {
  if (!doc || !fieldName) return null;
  const value = doc[fieldName];
  if (!value) return null;
  if (value && typeof value === "object" && value._id) return value;
  return value;
}

function buildStatementForStudent(student, invoices = [], payments = [], programsMap = new Map()) {
  const studentId = String(student._id);

  const studentInvoices = invoices.filter((inv) => {
    const sid = inv.studentId?._id ? String(inv.studentId._id) : String(inv.studentId || "");
    return sid === studentId;
  });

  const studentPayments = payments.filter((pay) => {
    const sid = pay.studentId?._id ? String(pay.studentId._id) : String(pay.studentId || "");
    return sid === studentId;
  });

  const activeInvoices = studentInvoices.filter((x) => x.isDeleted !== true);
  const activePayments = studentPayments.filter(
    (x) => x.isDeleted !== true && !["Voided", "Refunded"].includes(paymentStatus(x))
  );

  const totalInvoiced = activeInvoices
    .filter((x) => x.status !== "Cancelled")
    .reduce((sum, x) => sum + moneyNum(x.totalAmount), 0);

  const totalPaid = activePayments.reduce((sum, x) => sum + moneyNum(x.amount), 0);
  const balance = Math.max(0, totalInvoiced - totalPaid);

  const movements = [];

  activeInvoices.forEach((inv) => {
    if (inv.status === "Cancelled") return;

    const invProgram = getRefValue(inv, "programId");
    const programObj =
      invProgram && invProgram._id
        ? invProgram
        : invProgram
        ? programsMap.get(String(invProgram))
        : null;

    movements.push({
      type: "Invoice",
      ref: inv.invoiceNumber || "—",
      date: inv.issueDate ? new Date(inv.issueDate) : new Date(inv.createdAt || Date.now()),
      description: `${inv.term || ""} ${inv.academicYear || ""}`.trim() || "Invoice charge",
      programName: getProgramName(programObj),
      debit: moneyNum(inv.totalAmount),
      credit: 0,
      status: invoiceStatus(inv),
      rawDate: inv.issueDate
        ? new Date(inv.issueDate).toISOString().slice(0, 10)
        : inv.createdAt
        ? new Date(inv.createdAt).toISOString().slice(0, 10)
        : "",
    });
  });

  activePayments.forEach((pay) => {
    const payProgram = getRefValue(pay, "programId");
    const programObj =
      payProgram && payProgram._id
        ? payProgram
        : payProgram
        ? programsMap.get(String(payProgram))
        : null;

    movements.push({
      type: "Payment",
      ref: pay.receiptNumber || "—",
      date: pay.paymentDate ? new Date(pay.paymentDate) : new Date(pay.createdAt || Date.now()),
      description: `${pay.method || "Payment"}${pay.reference ? ` • ${pay.reference}` : ""}`,
      programName: getProgramName(programObj),
      debit: 0,
      credit: moneyNum(pay.amount),
      status: paymentStatus(pay),
      rawDate: pay.paymentDate
        ? new Date(pay.paymentDate).toISOString().slice(0, 10)
        : pay.createdAt
        ? new Date(pay.createdAt).toISOString().slice(0, 10)
        : "",
    });
  });

  movements.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return da - db;
  });

  let runningBalance = 0;
  const ledger = movements.map((m) => {
    runningBalance += moneyNum(m.debit) - moneyNum(m.credit);
    return {
      ...m,
      runningBalance,
    };
  });

  const studentProgram = getRefValue(student, "programId");
  const primaryProgram =
    studentProgram && studentProgram._id
      ? studentProgram
      : studentProgram
      ? programsMap.get(String(studentProgram))
      : null;

  return {
    id: studentId,
    studentName: getStudentName(student),
    admissionNumber: student.admissionNumber || "",
    programName: getProgramName(primaryProgram),
    totalInvoiced,
    totalPaid,
    balance,
    invoiceCount: activeInvoices.filter((x) => x.status !== "Cancelled").length,
    paymentCount: activePayments.length,
    ledger,
  };
}

module.exports = {
  /**
   * GET /admin/student-statements
   */
  index: async (req, res) => {
    try {
      const { Student, Invoice, Payment, Program } = req.models;
      const { clean } = buildFilters(req.query);

      let studentQuery = Student
        ? Student.find({})
            .select("firstName middleName lastName fullName admissionNumber programId createdAt")
            .sort({ createdAt: -1 })
        : null;

      if (Student && hasPath(Student, "programId")) {
        studentQuery = studentQuery.populate("programId", "name title code");
      }

      let invoiceQuery = Invoice
        ? Invoice.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .sort({ issueDate: 1, createdAt: 1 })
        : null;

      if (Invoice && hasPath(Invoice, "programId")) {
        invoiceQuery = invoiceQuery.populate("programId", "name title code");
      }

      let paymentQuery = Payment
        ? Payment.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .sort({ paymentDate: 1, createdAt: 1 })
        : null;

      if (Payment && hasPath(Payment, "programId")) {
        paymentQuery = paymentQuery.populate("programId", "name title code");
      }

      const [studentDocs, invoiceDocs, paymentDocs, programDocs] = await Promise.all([
        studentQuery ? studentQuery.lean() : [],
        invoiceQuery ? invoiceQuery.lean() : [],
        paymentQuery ? paymentQuery.lean() : [],
        Program
          ? Program.find({})
              .select("name title code")
              .sort({ name: 1, title: 1 })
              .lean()
          : [],
      ]);

      const programsMap = new Map((programDocs || []).map((p) => [String(p._id), p]));

      let filteredStudents = studentDocs || [];

      if (clean.student !== "all" && isValidId(clean.student)) {
        filteredStudents = filteredStudents.filter((s) => String(s._id) === clean.student);
      }

      if (clean.program !== "all" && isValidId(clean.program)) {
        filteredStudents = filteredStudents.filter((s) => {
          const pid = s.programId?._id
            ? String(s.programId._id)
            : String(s.programId || "");
          return pid === clean.program;
        });
      }

      if (clean.q) {
        const regex = new RegExp(clean.q, "i");
        filteredStudents = filteredStudents.filter((s) => {
          const studentProgram =
            s.programId?._id
              ? s.programId
              : s.programId
              ? programsMap.get(String(s.programId))
              : null;

          const text = [
            getStudentName(s),
            s.admissionNumber || "",
            getProgramName(studentProgram),
          ].join(" ");

          return regex.test(text);
        });
      }

      const statements = filteredStudents.map((student) =>
        buildStatementForStudent(student, invoiceDocs || [], paymentDocs || [], programsMap)
      );

      const totals = statements.reduce(
        (acc, s) => {
          acc.students += 1;
          acc.invoiced += moneyNum(s.totalInvoiced);
          acc.paid += moneyNum(s.totalPaid);
          acc.balance += moneyNum(s.balance);
          acc.invoices += Number(s.invoiceCount || 0);
          acc.payments += Number(s.paymentCount || 0);
          return acc;
        },
        { students: 0, invoiced: 0, paid: 0, balance: 0, invoices: 0, payments: 0 }
      );

      return res.render("tenant/admin/finance/student-statements", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        statements,
        students: (studentDocs || []).map((s) => ({
          id: String(s._id),
          name: getStudentName(s),
        })),
        programs: (programDocs || []).map((p) => ({
          id: String(p._id),
          name: getProgramName(p),
        })),
        totals,
        query: clean,
      });
    } catch (error) {
      console.error("studentStatementsController.index error:", error);
      return res.status(500).render("tenant/admin/error", {
        tenant: req.tenant,
        message: error.message || "Failed to load student statements.",
      });
    }
  },
};