const mongoose = require("mongoose");

const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const moneyNum = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

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

function schoolLevelLabel(v) {
  const map = {
    nursery: "Nursery",
    primary: "Primary",
    secondary: "Secondary",
  };
  return map[String(v || "").toLowerCase()] || "—";
}

function getStudentName(st) {
  if (!st) return "—";
  return (
    st.fullName ||
    [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") ||
    st.name ||
    st.regNo ||
    "—"
  );
}

function getStudentRegNo(st) {
  return st?.regNo || st?.admissionNumber || st?.studentNo || "—";
}

function getSubjectName(s) {
  if (!s) return "—";
  return s.title || s.shortTitle || s.code || "—";
}

function getSubjectCode(s) {
  return s?.code || "";
}

function getStudentSubjectNames(student) {
  if (!Array.isArray(student?.subjects) || !student.subjects.length) return [];
  return student.subjects
    .map((s) => {
      const code = getSubjectCode(s);
      const title = getSubjectName(s);
      return code && title && code !== title ? `${code} — ${title}` : title || code;
    })
    .filter(Boolean);
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
  const q = str(query.q, 120);
  const student = str(query.student || "all", 80);
  const schoolLevel = str(query.schoolLevel || "all", 30).toLowerCase();
  const classLevel = str(query.classLevel || "all", 20).toUpperCase();
  const term = str(query.term || "all", 10);
  const view = str(query.view || "list", 20) || "list";

  return {
    clean: { q, student, schoolLevel, classLevel, term, view },
  };
}

function invoiceDescription(inv) {
  const parts = [];

  if (inv?.description) parts.push(String(inv.description).trim());
  if (inv?.itemName) parts.push(String(inv.itemName).trim());
  if (inv?.term) parts.push(`Term ${inv.term}`);
  if (inv?.academicYear) parts.push(String(inv.academicYear).trim());

  return parts.filter(Boolean).join(" • ") || "Invoice charge";
}

function paymentDescription(pay) {
  const parts = [];
  if (pay?.method) parts.push(String(pay.method).trim());
  if (pay?.reference) parts.push(String(pay.reference).trim());
  if (pay?.notes) parts.push(String(pay.notes).trim());
  return parts.filter(Boolean).join(" • ") || "Payment";
}

function getEntrySchoolLevel(entry, student) {
  return (
    entry?.schoolLevel ||
    student?.schoolLevel ||
    ""
  );
}

function getEntryClassLevel(entry, student) {
  return (
    entry?.classLevel ||
    student?.classLevel ||
    ""
  );
}

function getEntryTerm(entry, student) {
  const term = entry?.term ?? student?.term ?? "";
  return term ? Number(term) : "";
}

function getEntryAcademicYear(entry) {
  return entry?.academicYear || "";
}

function buildStatementForStudent(student, invoices = [], payments = []) {
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

    movements.push({
      type: "Invoice",
      ref: inv.invoiceNumber || "—",
      date: inv.issueDate ? new Date(inv.issueDate) : new Date(inv.createdAt || Date.now()),
      rawDate: inv.issueDate
        ? new Date(inv.issueDate).toISOString().slice(0, 10)
        : inv.createdAt
        ? new Date(inv.createdAt).toISOString().slice(0, 10)
        : "",
      description: invoiceDescription(inv),
      schoolLevel: getEntrySchoolLevel(inv, student),
      classLevel: getEntryClassLevel(inv, student),
      term: getEntryTerm(inv, student),
      academicYear: getEntryAcademicYear(inv),
      debit: moneyNum(inv.totalAmount),
      credit: 0,
      status: invoiceStatus(inv),
    });
  });

  activePayments.forEach((pay) => {
    movements.push({
      type: "Payment",
      ref: pay.receiptNumber || "—",
      date: pay.paymentDate ? new Date(pay.paymentDate) : new Date(pay.createdAt || Date.now()),
      rawDate: pay.paymentDate
        ? new Date(pay.paymentDate).toISOString().slice(0, 10)
        : pay.createdAt
        ? new Date(pay.createdAt).toISOString().slice(0, 10)
        : "",
      description: paymentDescription(pay),
      schoolLevel: getEntrySchoolLevel(pay, student),
      classLevel: getEntryClassLevel(pay, student),
      term: getEntryTerm(pay, student),
      academicYear: getEntryAcademicYear(pay),
      debit: 0,
      credit: moneyNum(pay.amount),
      status: paymentStatus(pay),
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

  return {
    id: studentId,
    studentName: getStudentName(student),
    regNo: getStudentRegNo(student),
    schoolLevel: student.schoolLevel || "",
    classLevel: student.classLevel || "",
    term: Number(student.term || 1),
    academicYear: student.academicYear || "",
    status: student.status || "active",
    holdType: student.holdType || "",
    holdReason: student.holdReason || "",
    subjectNames: getStudentSubjectNames(student),
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
   * GET /tenant/student-statements
   */
  index: async (req, res) => {
    try {
      const { Student, Invoice, Payment } = req.models || {};
      const { clean } = buildFilters(req.query);

      let studentQuery = Student
        ? Student.find({ isDeleted: { $ne: true } })
            .select(
              [
                "firstName",
                "middleName",
                "lastName",
                "fullName",
                "regNo",
                "studentNo",
                "admissionNumber",
                "schoolLevel",
                "classLevel",
                "term",
                "academicYear",
                "subjects",
                "status",
                "holdType",
                "holdReason",
                "createdAt",
              ].join(" ")
            )
            .sort({ createdAt: -1 })
        : null;

      if (Student && hasPath(Student, "subjects")) {
        studentQuery = studentQuery.populate("subjects", "title shortTitle code");
      }

      let invoiceQuery = Invoice
        ? Invoice.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName regNo admissionNumber schoolLevel classLevel term")
            .sort({ issueDate: 1, createdAt: 1 })
        : null;

      let paymentQuery = Payment
        ? Payment.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName regNo admissionNumber schoolLevel classLevel term")
            .sort({ paymentDate: 1, createdAt: 1 })
        : null;

      const [studentDocs, invoiceDocs, paymentDocs] = await Promise.all([
        studentQuery ? studentQuery.lean() : [],
        invoiceQuery ? invoiceQuery.lean() : [],
        paymentQuery ? paymentQuery.lean() : [],
      ]);

      let filteredStudents = studentDocs || [];

      if (clean.student !== "all" && isValidId(clean.student)) {
        filteredStudents = filteredStudents.filter((s) => String(s._id) === clean.student);
      }

      if (clean.schoolLevel !== "all") {
        filteredStudents = filteredStudents.filter(
          (s) => String(s.schoolLevel || "").toLowerCase() === clean.schoolLevel
        );
      }

      if (clean.classLevel !== "all") {
        filteredStudents = filteredStudents.filter(
          (s) => String(s.classLevel || "").toUpperCase() === clean.classLevel
        );
      }

      if (clean.term !== "all" && [1, 2, 3].includes(Number(clean.term))) {
        filteredStudents = filteredStudents.filter((s) => Number(s.term || 1) === Number(clean.term));
      }

      if (clean.q) {
        const regex = new RegExp(clean.q, "i");
        filteredStudents = filteredStudents.filter((s) => {
          const text = [
            getStudentName(s),
            getStudentRegNo(s),
            schoolLevelLabel(s.schoolLevel),
            s.classLevel || "",
            ...(getStudentSubjectNames(s) || []),
          ].join(" ");

          return regex.test(text);
        });
      }

      const statements = filteredStudents.map((student) =>
        buildStatementForStudent(student, invoiceDocs || [], paymentDocs || [])
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

      return res.render("tenant/finance/student-statements", {
        tenant: req.tenant || null,
        csrfToken: req.csrfToken?.() || null,
        statements,
        students: (studentDocs || []).map((s) => ({
          id: String(s._id),
          name: getStudentName(s),
          regNo: getStudentRegNo(s),
        })),
        totals,
        query: clean,
      });
    } catch (error) {
      console.error("studentStatementsController.index error:", error);
      return res.status(500).render("platform/public/500", {
        tenant: req.tenant || null,
        message: error.message || "Failed to load student statements.",
      });
    }
  },
};