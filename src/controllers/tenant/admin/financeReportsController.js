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

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function dateInRange(dateValue, range) {
  if (!dateValue) return !range?.from && !range?.to;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  if (range?.from && d < range.from) return false;
  if (range?.to && d > range.to) return false;
  return true;
}

function resolvePeriodRange(period) {
  const now = new Date();

  if (period === "today") {
    return { from: startOfDay(now), to: endOfDay(now) };
  }

  if (period === "last_30_days") {
    const from = new Date();
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
    return { from, to: endOfDay(now) };
  }

  if (period === "this_year") {
    return {
      from: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
      to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
    };
  }

  if (period === "all_time") {
    return { from: null, to: null };
  }

  return { from: startOfMonth(now), to: endOfMonth(now) };
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

function buildFilters(query = {}) {
  const q = str(query.q);
  const period = str(query.period || "this_month");
  const program = str(query.program || "all");
  const student = str(query.student || "all");
  const view = str(query.view || "overview") || "overview";

  return {
    clean: { q, period, program, student, view },
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

function getDocProgram(doc, programsMap) {
  const programValue = getRefValue(doc, "programId");
  if (!programValue) return null;
  if (programValue && typeof programValue === "object" && programValue._id) return programValue;
  return programsMap.get(String(programValue)) || null;
}

module.exports = {
  /**
   * GET /admin/finance-reports
   */
  index: async (req, res) => {
    try {
      const {
        Invoice,
        Payment,
        Expense,
        Scholarship,
        Student,
        Program,
      } = req.models;

      const { clean } = buildFilters(req.query);
      const range = resolvePeriodRange(clean.period);

      let invoiceQuery = Invoice
        ? Invoice.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .sort({ issueDate: -1, createdAt: -1 })
        : null;

      if (Invoice && hasPath(Invoice, "programId")) {
        invoiceQuery = invoiceQuery.populate("programId", "name title code");
      }

      let paymentQuery = Payment
        ? Payment.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .populate("invoiceId", "invoiceNumber")
            .sort({ paymentDate: -1, createdAt: -1 })
        : null;

      if (Payment && hasPath(Payment, "programId")) {
        paymentQuery = paymentQuery.populate("programId", "name title code");
      }

      let scholarshipQuery = Scholarship
        ? Scholarship.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .sort({ createdAt: -1 })
        : null;

      if (Scholarship && hasPath(Scholarship, "programId")) {
        scholarshipQuery = scholarshipQuery.populate("programId", "name title code");
      }

      let studentQuery = Student
        ? Student.find({})
            .select("firstName middleName lastName fullName admissionNumber programId createdAt")
            .sort({ createdAt: -1 })
        : null;

      if (Student && hasPath(Student, "programId")) {
        studentQuery = studentQuery.populate("programId", "name title code");
      }

      const [invoiceDocs, paymentDocs, expenseDocs, scholarshipDocs, studentDocs, programDocs] =
        await Promise.all([
          invoiceQuery ? invoiceQuery.lean() : [],
          paymentQuery ? paymentQuery.lean() : [],
          Expense
            ? Expense.find({ isDeleted: { $ne: true } })
                .sort({ expenseDate: -1, createdAt: -1 })
                .lean()
            : [],
          scholarshipQuery ? scholarshipQuery.lean() : [],
          studentQuery ? studentQuery.lean() : [],
          Program
            ? Program.find({})
                .select("name title code")
                .sort({ name: 1, title: 1 })
                .lean()
            : [],
        ]);

      const programsMap = new Map(
        (programDocs || []).map((p) => [String(p._id), p])
      );

      let invoices = invoiceDocs || [];
      let payments = paymentDocs || [];
      let expenses = expenseDocs || [];
      let scholarships = scholarshipDocs || [];
      let students = studentDocs || [];

      if (clean.program !== "all" && isValidId(clean.program)) {
        invoices = invoices.filter((x) => {
          const p = getDocProgram(x, programsMap);
          const pid = p?._id ? String(p._id) : "";
          return pid === clean.program;
        });

        payments = payments.filter((x) => {
          const p = getDocProgram(x, programsMap);
          const pid = p?._id ? String(p._id) : "";
          return pid === clean.program;
        });

        scholarships = scholarships.filter((x) => {
          const p = getDocProgram(x, programsMap);
          const pid = p?._id ? String(p._id) : "";
          return pid === clean.program;
        });

        students = students.filter((x) => {
          const p = getDocProgram(x, programsMap);
          const pid = p?._id ? String(p._id) : "";
          return pid === clean.program;
        });
      }

      if (clean.student !== "all" && isValidId(clean.student)) {
        invoices = invoices.filter((x) => {
          const sid = x.studentId?._id ? String(x.studentId._id) : String(x.studentId || "");
          return sid === clean.student;
        });

        payments = payments.filter((x) => {
          const sid = x.studentId?._id ? String(x.studentId._id) : String(x.studentId || "");
          return sid === clean.student;
        });

        scholarships = scholarships.filter((x) => {
          const sid = x.studentId?._id ? String(x.studentId._id) : String(x.studentId || "");
          return sid === clean.student;
        });

        students = students.filter((x) => String(x._id) === clean.student);
      }

      if (clean.q) {
        const regex = new RegExp(clean.q, "i");

        invoices = invoices.filter((x) => {
          const text = [
            x.invoiceNumber || "",
            x.reference || "",
            x.term || "",
            x.academicYear || "",
            getStudentName(x.studentId),
            getProgramName(getDocProgram(x, programsMap)),
          ].join(" ");
          return regex.test(text);
        });

        payments = payments.filter((x) => {
          const text = [
            x.receiptNumber || "",
            x.reference || "",
            x.method || "",
            x.term || "",
            x.academicYear || "",
            getStudentName(x.studentId),
            getProgramName(getDocProgram(x, programsMap)),
          ].join(" ");
          return regex.test(text);
        });

        expenses = expenses.filter((x) => {
          const text = [
            x.expenseNumber || "",
            x.voucherNo || "",
            x.reference || "",
            x.title || "",
            x.description || "",
            x.category || "",
          ].join(" ");
          return regex.test(text);
        });

        scholarships = scholarships.filter((x) => {
          const text = [
            x.name || "",
            x.code || "",
            x.sponsor || "",
            x.type || "",
            getStudentName(x.studentId),
            getProgramName(getDocProgram(x, programsMap)),
          ].join(" ");
          return regex.test(text);
        });

        students = students.filter((x) => {
          const text = [
            getStudentName(x),
            x.admissionNumber || "",
            getProgramName(getDocProgram(x, programsMap)),
          ].join(" ");
          return regex.test(text);
        });
      }

      invoices = invoices.filter((x) =>
        dateInRange(x.issueDate || x.createdAt, range)
      );

      payments = payments.filter((x) =>
        dateInRange(x.paymentDate || x.createdAt, range)
      );

      expenses = expenses.filter((x) =>
        dateInRange(x.expenseDate || x.createdAt, range)
      );

      scholarships = scholarships.filter((x) =>
        dateInRange(x.startDate || x.createdAt, range)
      );

      const billed = invoices
        .filter((x) => x.status !== "Cancelled")
        .reduce((sum, x) => sum + moneyNum(x.totalAmount), 0);

      const collected = payments
        .filter((x) => !["Voided", "Refunded"].includes(x.status))
        .reduce((sum, x) => sum + moneyNum(x.amount), 0);

      const expensesTotal = expenses
        .filter((x) => x.status !== "Rejected")
        .reduce((sum, x) => sum + moneyNum(x.amount), 0);

      const outstanding = invoices
        .filter((x) => !["Cancelled", "Draft"].includes(x.status))
        .reduce((sum, x) => {
          const bal =
            x.balance !== undefined && x.balance !== null
              ? moneyNum(x.balance)
              : Math.max(0, moneyNum(x.totalAmount) - moneyNum(x.paidAmount));
          return sum + bal;
        }, 0);

      const invoiceSummary = {
        total: invoices.length,
        paid: invoices.filter((x) => invoiceStatus(x) === "Paid").length,
        partial: invoices.filter((x) => invoiceStatus(x) === "Partially Paid").length,
        unpaid: invoices.filter((x) => invoiceStatus(x) === "Unpaid").length,
        cancelled: invoices.filter((x) => invoiceStatus(x) === "Cancelled").length,
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
        categories: Object.entries(
          expenses.reduce((acc, x) => {
            const key = x.category || "Other";
            acc[key] = (acc[key] || 0) + moneyNum(x.amount);
            return acc;
          }, {})
        )
          .map(([label, amount]) => ({ label, amount }))
          .sort((a, b) => b.amount - a.amount),
      };

      const scholarshipSummary = {
        total: scholarships.length,
        active: scholarships.filter((x) => x.status === "Active").length,
        percentage: scholarships.filter((x) => x.type === "Percentage").length,
        fixed: scholarships.filter((x) => x.type === "Fixed Amount").length,
        full: scholarships.filter((x) => x.type === "Full").length,
      };

      const collectionByMethod = Object.entries(
        payments
          .filter((x) => !["Voided", "Refunded"].includes(x.status))
          .reduce((acc, x) => {
            const key = x.method || "Cash";
            acc[key] = (acc[key] || 0) + moneyNum(x.amount);
            return acc;
          }, {})
      )
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount);

      const balancesByStudent = students
        .map((student) => {
          const sid = String(student._id);

          const studentInvoices = invoices.filter((x) => {
            const xId = x.studentId?._id ? String(x.studentId._id) : String(x.studentId || "");
            return xId === sid && x.status !== "Cancelled";
          });

          const studentPayments = payments.filter((x) => {
            const xId = x.studentId?._id ? String(x.studentId._id) : String(x.studentId || "");
            return xId === sid && !["Voided", "Refunded"].includes(x.status);
          });

          const totalInvoiced = studentInvoices.reduce((sum, x) => sum + moneyNum(x.totalAmount), 0);
          const totalPaid = studentPayments.reduce((sum, x) => sum + moneyNum(x.amount), 0);
          const balance = Math.max(0, totalInvoiced - totalPaid);

          return {
            studentId: sid,
            studentName: getStudentName(student),
            admissionNumber: student.admissionNumber || "",
            programName: getProgramName(getDocProgram(student, programsMap)),
            totalInvoiced,
            totalPaid,
            balance,
          };
        })
        .filter((x) => x.totalInvoiced > 0 || x.totalPaid > 0 || x.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      const recentActivity = [
        ...invoices.map((x) => ({
          type: "Invoice",
          ref: x.invoiceNumber || "—",
          description: `${getStudentName(x.studentId)} • ${getProgramName(getDocProgram(x, programsMap))}`,
          amount: moneyNum(x.totalAmount),
          status: invoiceStatus(x),
          rawDate: x.issueDate
            ? new Date(x.issueDate).toISOString().slice(0, 10)
            : x.createdAt
            ? new Date(x.createdAt).toISOString().slice(0, 10)
            : "",
          ts: x.issueDate ? new Date(x.issueDate).getTime() : new Date(x.createdAt || Date.now()).getTime(),
        })),
        ...payments.map((x) => ({
          type: "Payment",
          ref: x.receiptNumber || "—",
          description: `${getStudentName(x.studentId)} • ${x.method || "Cash"}`,
          amount: moneyNum(x.amount),
          status: x.status || "Completed",
          rawDate: x.paymentDate
            ? new Date(x.paymentDate).toISOString().slice(0, 10)
            : x.createdAt
            ? new Date(x.createdAt).toISOString().slice(0, 10)
            : "",
          ts: x.paymentDate ? new Date(x.paymentDate).getTime() : new Date(x.createdAt || Date.now()).getTime(),
        })),
        ...expenses.map((x) => ({
          type: "Expense",
          ref: x.expenseNumber || x.reference || "—",
          description: `${x.title || x.category || "Expense"}`,
          amount: moneyNum(x.amount),
          status: x.status || "Recorded",
          rawDate: x.expenseDate
            ? new Date(x.expenseDate).toISOString().slice(0, 10)
            : x.createdAt
            ? new Date(x.createdAt).toISOString().slice(0, 10)
            : "",
          ts: x.expenseDate ? new Date(x.expenseDate).getTime() : new Date(x.createdAt || Date.now()).getTime(),
        })),
      ]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 30);

      return res.render("tenant/admin/finance/finance-reports", {
        tenant: req.tenant,
        csrfToken: req.csrfToken?.(),
        reports: {
          overview: {
            billed,
            collected,
            outstanding,
            expenses: expensesTotal,
            net: collected - expensesTotal,
          },
          invoiceSummary,
          paymentSummary,
          expenseSummary,
          scholarshipSummary,
          collectionByMethod,
          balancesByStudent,
          recentActivity,
        },
        programs: (programDocs || []).map((p) => ({
          id: String(p._id),
          name: getProgramName(p),
        })),
        students: (studentDocs || []).map((s) => ({
          id: String(s._id),
          name: getStudentName(s),
        })),
        query: clean,
      });
    } catch (error) {
      console.error("financeReportsController.index error:", error);
      return res.status(500).render("tenant/admin/error", {
        tenant: req.tenant,
        message: error.message || "Failed to load finance reports.",
      });
    }
  },
};