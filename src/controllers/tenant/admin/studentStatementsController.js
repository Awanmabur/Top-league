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

function schoolLevelLabel(v) {
  const map = {
    nursery: "Nursery",
    primary: "Primary",
    secondary: "Secondary",
  };
  return map[String(v || "").toLowerCase()] || "-";
}

function getStudentName(student) {
  if (!student) return "-";
  return (
    student.fullName ||
    [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") ||
    student.name ||
    student.regNo ||
    "-"
  );
}

function getStudentRegNo(student) {
  return student?.regNo || student?.admissionNumber || student?.studentNo || "-";
}

function getSubjectName(subject) {
  if (!subject) return "-";
  return subject.title || subject.shortTitle || subject.name || subject.code || "-";
}

function getSubjectLabel(subject) {
  if (!subject) return "-";
  const code = str(subject.code, 40);
  const name = getSubjectName(subject);
  return code && code !== name ? `${code} - ${name}` : name;
}

function getStudentSubjectRefs(student) {
  if (!Array.isArray(student?.subjects)) return [];
  return student.subjects.map((subject) => {
    if (subject && typeof subject === "object" && subject._id) return String(subject._id);
    return String(subject || "");
  });
}

function getStudentSubjectNames(student) {
  if (!Array.isArray(student?.subjects)) return [];
  return student.subjects.map(getSubjectLabel).filter(Boolean);
}

function getStudentAcademicLabel(student) {
  const subjectNames = getStudentSubjectNames(student);
  if (subjectNames.length) return subjectNames.join(", ");

  const parts = [student?.className, student?.section, student?.stream].filter(Boolean);
  return parts.length ? parts.join(" - ") : "-";
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

function paymentStatus(payment) {
  return payment?.status || "Completed";
}

function buildFilters(query = {}) {
  const q = str(query.q, 120);
  const student = str(query.student || "all", 80);
  const program = str(query.program || "all", 80);
  const schoolLevel = str(query.schoolLevel || "all", 30).toLowerCase();
  const classLevel = str(query.classLevel || "all", 20).toUpperCase();
  const term = str(query.term || "all", 10);
  const view = str(query.view || "list", 20) || "list";

  return {
    clean: { q, student, program, schoolLevel, classLevel, term, view },
  };
}

function invoiceDescription(inv) {
  const parts = [];
  if (inv?.description) parts.push(str(inv.description, 200));
  if (inv?.itemName) parts.push(str(inv.itemName, 120));
  if (inv?.term) parts.push(str(inv.term, 40));
  if (inv?.academicYear) parts.push(str(inv.academicYear, 40));
  return parts.filter(Boolean).join(" - ") || "Invoice charge";
}

function paymentDescription(payment) {
  const parts = [];
  if (payment?.method) parts.push(str(payment.method, 40));
  if (payment?.reference) parts.push(str(payment.reference, 80));
  if (payment?.notes) parts.push(str(payment.notes, 200));
  return parts.filter(Boolean).join(" - ") || "Payment";
}

function buildStatementForStudent(student, invoices = [], payments = []) {
  const studentId = String(student._id);
  const subjectNames = getStudentSubjectNames(student);
  const subjectIds = getStudentSubjectRefs(student);
  const academicLabel = getStudentAcademicLabel(student);

  const studentInvoices = invoices.filter((invoice) => {
    const sid = invoice.studentId?._id
      ? String(invoice.studentId._id)
      : String(invoice.studentId || "");
    return sid === studentId;
  });

  const studentPayments = payments.filter((payment) => {
    const sid = payment.studentId?._id
      ? String(payment.studentId._id)
      : String(payment.studentId || "");
    return sid === studentId;
  });

  const activeInvoices = studentInvoices.filter((invoice) => invoice.isDeleted !== true);
  const activePayments = studentPayments.filter(
    (payment) =>
      payment.isDeleted !== true && !["Voided", "Refunded"].includes(paymentStatus(payment))
  );

  const totalInvoiced = activeInvoices
    .filter((invoice) => invoice.status !== "Cancelled")
    .reduce((sum, invoice) => sum + moneyNum(invoice.totalAmount), 0);

  const totalPaid = activePayments.reduce((sum, payment) => sum + moneyNum(payment.amount), 0);
  const balance = Math.max(0, totalInvoiced - totalPaid);

  const movements = [];

  activeInvoices.forEach((invoice) => {
    if (invoice.status === "Cancelled") return;

    const subject = invoice.programId || null;
    const subjectId = subject?._id ? String(subject._id) : String(invoice.programId || "");

    movements.push({
      type: "Invoice",
      ref: invoice.invoiceNumber || "-",
      date: invoice.issueDate ? new Date(invoice.issueDate) : new Date(invoice.createdAt || Date.now()),
      rawDate: invoice.issueDate
        ? new Date(invoice.issueDate).toISOString().slice(0, 10)
        : invoice.createdAt
          ? new Date(invoice.createdAt).toISOString().slice(0, 10)
          : "",
      description: invoiceDescription(invoice),
      programId: subjectId,
      programName: subject ? getSubjectLabel(subject) : academicLabel,
      schoolLevel: student.schoolLevel || "",
      classLevel: student.classLevel || "",
      term: invoice.term || student.term || "",
      academicYear: invoice.academicYear || student.academicYear || "",
      debit: moneyNum(invoice.totalAmount),
      credit: 0,
      status: invoiceStatus(invoice),
    });
  });

  activePayments.forEach((payment) => {
    const subject = payment.programId || null;
    const subjectId = subject?._id ? String(subject._id) : String(payment.programId || "");

    movements.push({
      type: "Payment",
      ref: payment.receiptNumber || "-",
      date: payment.paymentDate
        ? new Date(payment.paymentDate)
        : new Date(payment.createdAt || Date.now()),
      rawDate: payment.paymentDate
        ? new Date(payment.paymentDate).toISOString().slice(0, 10)
        : payment.createdAt
          ? new Date(payment.createdAt).toISOString().slice(0, 10)
          : "",
      description: paymentDescription(payment),
      programId: subjectId,
      programName: subject ? getSubjectLabel(subject) : academicLabel,
      schoolLevel: student.schoolLevel || "",
      classLevel: student.classLevel || "",
      term: payment.term || student.term || "",
      academicYear: payment.academicYear || student.academicYear || "",
      debit: 0,
      credit: moneyNum(payment.amount),
      status: paymentStatus(payment),
    });
  });

  movements.sort((a, b) => {
    const left = a.date ? new Date(a.date).getTime() : 0;
    const right = b.date ? new Date(b.date).getTime() : 0;
    return left - right;
  });

  let runningBalance = 0;
  const ledger = movements.map((movement) => {
    runningBalance += moneyNum(movement.debit) - moneyNum(movement.credit);
    return {
      ...movement,
      runningBalance,
    };
  });

  return {
    id: studentId,
    studentName: getStudentName(student),
    admissionNumber: getStudentRegNo(student),
    regNo: getStudentRegNo(student),
    schoolLevel: student.schoolLevel || "",
    classLevel: student.classLevel || "",
    term: Number(student.term || 1),
    academicYear: student.academicYear || "",
    status: student.status || "active",
    holdType: student.holdType || "",
    holdReason: student.holdReason || "",
    subjectNames,
    programIds: subjectIds,
    programName: subjectNames.length ? subjectNames.join(", ") : academicLabel,
    totalInvoiced,
    totalPaid,
    balance,
    invoiceCount: activeInvoices.filter((invoice) => invoice.status !== "Cancelled").length,
    paymentCount: activePayments.length,
    ledger,
  };
}

module.exports = {
  index: async (req, res) => {
    try {
      const { Student, Invoice, Payment, Subject, Program } = req.models || {};
      const AcademicSubject = Subject || Program || null;
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
                "className",
                "section",
                "stream",
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
        studentQuery = studentQuery.populate("subjects", "title shortTitle name code");
      }

      let invoiceQuery = Invoice
        ? Invoice.find({ isDeleted: { $ne: true } })
            .populate(
              "studentId",
              "firstName middleName lastName fullName regNo admissionNumber schoolLevel classLevel className section stream term academicYear"
            )
            .sort({ issueDate: 1, createdAt: 1 })
        : null;

      if (Invoice && hasPath(Invoice, "programId")) {
        invoiceQuery = invoiceQuery.populate("programId", "title shortTitle name code");
      }

      let paymentQuery = Payment
        ? Payment.find({ isDeleted: { $ne: true } })
            .populate(
              "studentId",
              "firstName middleName lastName fullName regNo admissionNumber schoolLevel classLevel className section stream term academicYear"
            )
            .sort({ paymentDate: 1, createdAt: 1 })
        : null;

      if (Payment && hasPath(Payment, "programId")) {
        paymentQuery = paymentQuery.populate("programId", "title shortTitle name code");
      }

      const [studentDocs, invoiceDocs, paymentDocs, programDocs] = await Promise.all([
        studentQuery ? studentQuery.lean() : [],
        invoiceQuery ? invoiceQuery.lean() : [],
        paymentQuery ? paymentQuery.lean() : [],
        AcademicSubject
          ? AcademicSubject.find({ isDeleted: { $ne: true } })
              .select("title shortTitle name code")
              .sort({ title: 1, shortTitle: 1, name: 1, code: 1 })
              .lean()
          : [],
      ]);

      let filteredStudents = studentDocs || [];

      if (clean.student !== "all" && isValidId(clean.student)) {
        filteredStudents = filteredStudents.filter((student) => String(student._id) === clean.student);
      }

      if (clean.schoolLevel !== "all") {
        filteredStudents = filteredStudents.filter(
          (student) => String(student.schoolLevel || "").toLowerCase() === clean.schoolLevel
        );
      }

      if (clean.classLevel !== "all") {
        filteredStudents = filteredStudents.filter(
          (student) => String(student.classLevel || "").toUpperCase() === clean.classLevel
        );
      }

      if (clean.term !== "all" && [1, 2, 3].includes(Number(clean.term))) {
        filteredStudents = filteredStudents.filter(
          (student) => Number(student.term || 1) === Number(clean.term)
        );
      }

      if (clean.q) {
        const regex = new RegExp(clean.q, "i");
        filteredStudents = filteredStudents.filter((student) => {
          const text = [
            getStudentName(student),
            getStudentRegNo(student),
            schoolLevelLabel(student.schoolLevel),
            student.classLevel || "",
            student.className || "",
            student.section || "",
            student.stream || "",
            ...(getStudentSubjectNames(student) || []),
          ].join(" ");

          return regex.test(text);
        });
      }

      let statements = filteredStudents.map((student) =>
        buildStatementForStudent(student, invoiceDocs || [], paymentDocs || [])
      );

      if (clean.program !== "all" && isValidId(clean.program)) {
        statements = statements.filter((statement) => {
          if (statement.programIds.includes(clean.program)) return true;
          return statement.ledger.some((row) => row.programId === clean.program);
        });
      }

      const totals = statements.reduce(
        (acc, statement) => {
          acc.students += 1;
          acc.invoiced += moneyNum(statement.totalInvoiced);
          acc.paid += moneyNum(statement.totalPaid);
          acc.balance += moneyNum(statement.balance);
          acc.invoices += Number(statement.invoiceCount || 0);
          acc.payments += Number(statement.paymentCount || 0);
          return acc;
        },
        { students: 0, invoiced: 0, paid: 0, balance: 0, invoices: 0, payments: 0 }
      );

      return res.render("tenant/finance/student-statements", {
        tenant: req.tenant || null,
        csrfToken: req.csrfToken?.() || null,
        statements,
        students: (studentDocs || []).map((student) => ({
          id: String(student._id),
          name: getStudentName(student),
          regNo: getStudentRegNo(student),
        })),
        programs: (programDocs || []).map((subject) => ({
          id: String(subject._id),
          name: getSubjectLabel(subject),
        })),
        totals,
        query: clean,
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
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
