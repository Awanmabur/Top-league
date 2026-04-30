const mongoose = require("mongoose");

const str = (v) => String(v ?? "").trim();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

function safeNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  return safeNum(v);
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

function modelExists(req, name) {
  return !!req.models?.[name];
}

async function countSafe(Model, filter = {}) {
  if (!Model) return 0;
  try {
    return await Model.countDocuments(filter);
  } catch (_) {
    return 0;
  }
}

async function findSafe(Model, filter = {}, projection = null, options = {}) {
  if (!Model) return [];
  try {
    let q = Model.find(filter, projection || undefined);
    if (options.sort) q = q.sort(options.sort);
    if (options.limit) q = q.limit(options.limit);
    if (options.populate) {
      const pops = Array.isArray(options.populate) ? options.populate : [options.populate];
      pops.forEach((p) => {
        q = q.populate(p);
      });
    }
    return await q.lean();
  } catch (_) {
    return [];
  }
}

function getStudentName(st) {
  if (!st) return "—";
  return (
    st.fullName ||
    [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") ||
    st.name ||
    st.regNo ||
    st.admissionNumber ||
    "—"
  );
}

function getProgramName(p) {
  if (!p) return "—";
  return p.title || p.shortTitle || p.name || p.programName || p.code || "—";
}

function invoiceAmount(inv) {
  return safeNum(
    inv.totalAmount ??
    inv.amount ??
    inv.grandTotal ??
    inv.netAmount ??
    inv.balanceBeforePayments ??
    0
  );
}

function invoicePaid(inv) {
  return safeNum(
    inv.paidAmount ??
    inv.amountPaid ??
    inv.totalPaid ??
    0
  );
}

function invoiceBalance(inv) {
  const explicit = inv.balance ?? inv.balanceAmount ?? inv.amountDue;
  if (explicit !== undefined && explicit !== null) return safeNum(explicit);
  return Math.max(0, invoiceAmount(inv) - invoicePaid(inv));
}

function paymentAmount(p) {
  return safeNum(
    p.amount ??
    p.amountPaid ??
    p.receivedAmount ??
    p.total ??
    0
  );
}

function expenseAmount(e) {
  return safeNum(
    e.amount ??
    e.total ??
    e.totalAmount ??
    0
  );
}

function feeStructureAmount(f) {
  return safeNum(
    f.totalAmount ??
    f.amount ??
    f.total ??
    f.annualAmount ??
    0
  );
}

function scholarshipAmount(s) {
  return safeNum(
    s.amount ??
    s.value ??
    s.discountAmount ??
    0
  );
}

function paymentMethodLabel(p) {
  return (
    p.method ||
    p.paymentMethod ||
    p.channel ||
    "Cash"
  );
}

function invoiceStatusLabel(inv) {
  return (
    inv.status ||
    (invoiceBalance(inv) <= 0 ? "Paid" : invoicePaid(inv) > 0 ? "Partially Paid" : "Unpaid")
  );
}

function expenseStatusLabel(exp) {
  return exp.status || "Recorded";
}

function serializeRecentInvoice(inv) {
  const student = inv.studentId || inv.student || null;
  const program = inv.programId || inv.program || null;

  return {
    id: String(inv._id),
    invoiceNo: inv.invoiceNumber || inv.invoiceNo || inv.reference || "—",
    studentName: getStudentName(student),
    programName: getProgramName(program),
    amount: invoiceAmount(inv),
    paid: invoicePaid(inv),
    balance: invoiceBalance(inv),
    status: invoiceStatusLabel(inv),
    dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : "—",
    createdAt: inv.createdAt ? new Date(inv.createdAt).toISOString().slice(0, 10) : "",
  };
}

function serializeRecentPayment(p) {
  const student = p.studentId || p.student || null;

  return {
    id: String(p._id),
    receiptNo: p.receiptNumber || p.receiptNo || p.reference || "—",
    studentName: getStudentName(student),
    amount: paymentAmount(p),
    method: paymentMethodLabel(p),
    date: p.paymentDate
      ? new Date(p.paymentDate).toISOString().slice(0, 10)
      : p.createdAt
      ? new Date(p.createdAt).toISOString().slice(0, 10)
      : "—",
    status: p.status || "Completed",
  };
}

function serializeRecentExpense(exp) {
  return {
    id: String(exp._id),
    expenseNo: exp.expenseNumber || exp.reference || exp.voucherNo || "—",
    title: exp.title || exp.description || exp.category || "Expense",
    category: exp.category || "General",
    amount: expenseAmount(exp),
    status: expenseStatusLabel(exp),
    date: exp.expenseDate
      ? new Date(exp.expenseDate).toISOString().slice(0, 10)
      : exp.createdAt
      ? new Date(exp.createdAt).toISOString().slice(0, 10)
      : "—",
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const period = str(query.period || "this_month");
  const program = str(query.program || "all");
  const status = str(query.status || "all");
  const view = str(query.view || "overview") || "overview";

  return {
    clean: { q, period, program, status, view },
  };
}

function resolvePeriodRange(period) {
  const now = new Date();

  if (period === "today") {
    return { from: startOfDay(now), to: endOfDay(now) };
  }

  if (period === "this_month") {
    return { from: startOfMonth(now), to: endOfMonth(now) };
  }

  if (period === "all_time") {
    return { from: null, to: null };
  }

  if (period === "last_30_days") {
    const from = new Date();
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
    return { from, to: endOfDay(now) };
  }

  return { from: startOfMonth(now), to: endOfMonth(now) };
}

function dateFilter(field, range) {
  if (!range?.from && !range?.to) return {};
  const q = {};
  if (range.from) q.$gte = range.from;
  if (range.to) q.$lte = range.to;
  return { [field]: q };
}

function sumInvoices(list = []) {
  return list.reduce((acc, inv) => {
    acc.billed += invoiceAmount(inv);
    acc.paid += invoicePaid(inv);
    acc.balance += invoiceBalance(inv);
    return acc;
  }, { billed: 0, paid: 0, balance: 0 });
}

function groupPaymentsByMethod(list = []) {
  const map = {};
  list.forEach((p) => {
    const key = paymentMethodLabel(p);
    map[key] = (map[key] || 0) + paymentAmount(p);
  });

  return Object.keys(map).map((k) => ({
    label: k,
    amount: map[k],
  })).sort((a, b) => b.amount - a.amount);
}

function groupExpensesByCategory(list = []) {
  const map = {};
  list.forEach((e) => {
    const key = e.category || "General";
    map[key] = (map[key] || 0) + expenseAmount(e);
  });

  return Object.keys(map).map((k) => ({
    label: k,
    amount: map[k],
  })).sort((a, b) => b.amount - a.amount);
}

module.exports = {
  /**
   * GET /admin/finance
   */
  index: async (req, res) => {
    const {
      Student,
      Subject,
      Program,
      Invoice,
      Payment,
      FeeStructure,
      Scholarship,
      Expense,
    } = req.models || {};
    const AcademicSubject = Subject || Program || null;

    const { clean } = buildFilters(req.query);
    const range = resolvePeriodRange(clean.period);

    const invoiceDateQuery = range.from || range.to
      ? dateFilter("createdAt", range)
      : {};

    const paymentDateQuery = range.from || range.to
      ? {
          $or: [
            dateFilter("paymentDate", range),
            dateFilter("createdAt", range),
          ],
        }
      : {};

    const expenseDateQuery = range.from || range.to
      ? {
          $or: [
            dateFilter("expenseDate", range),
            dateFilter("createdAt", range),
          ],
        }
      : {};

    const invoiceMongo = { isDeleted: { $ne: true } };
    const paymentMongo = { isDeleted: { $ne: true } };
    const expenseMongo = { isDeleted: { $ne: true } };

    if (Object.keys(invoiceDateQuery).length) Object.assign(invoiceMongo, invoiceDateQuery);
    if (Object.keys(paymentDateQuery).length) Object.assign(paymentMongo, paymentDateQuery);
    if (Object.keys(expenseDateQuery).length) Object.assign(expenseMongo, expenseDateQuery);

    if (clean.status !== "all") {
      invoiceMongo.status = clean.status;
    }

    if (clean.q) {
      invoiceMongo.$or = [
        { invoiceNumber: new RegExp(clean.q, "i") },
        { invoiceNo: new RegExp(clean.q, "i") },
        { reference: new RegExp(clean.q, "i") },
        { status: new RegExp(clean.q, "i") },
      ];

      paymentMongo.$or = [
        { receiptNumber: new RegExp(clean.q, "i") },
        { receiptNo: new RegExp(clean.q, "i") },
        { reference: new RegExp(clean.q, "i") },
        { method: new RegExp(clean.q, "i") },
        { paymentMethod: new RegExp(clean.q, "i") },
      ];

      expenseMongo.$or = [
        { title: new RegExp(clean.q, "i") },
        { description: new RegExp(clean.q, "i") },
        { category: new RegExp(clean.q, "i") },
        { expenseNumber: new RegExp(clean.q, "i") },
        { voucherNo: new RegExp(clean.q, "i") },
      ];
    }

    let selectedProgramId = null;
    if (clean.program !== "all" && isValidId(clean.program)) {
      selectedProgramId = clean.program;
      invoiceMongo.$or = [
        ...(invoiceMongo.$or || []),
        { programId: clean.program },
        { program: clean.program },
      ];
    }

    const [
      studentCount,
      programCount,
      feeStructureCount,
      scholarshipCount,
      invoiceDocs,
      paymentDocs,
      expenseDocs,
      programOptions,
      recentInvoicesRaw,
      recentPaymentsRaw,
      recentExpensesRaw,
    ] = await Promise.all([
      countSafe(Student),
      countSafe(AcademicSubject),
      countSafe(FeeStructure),
      countSafe(Scholarship),
      findSafe(Invoice, invoiceMongo),
      findSafe(Payment, paymentMongo),
      findSafe(Expense, expenseMongo),
      findSafe(
        AcademicSubject,
        {},
        "title shortTitle name programName code",
        { sort: { title: 1, shortTitle: 1, name: 1, code: 1 } }
      ),
      findSafe(Invoice, invoiceMongo, null, {
        sort: { createdAt: -1 },
        limit: 8,
        populate: [
          { path: "studentId", select: "firstName middleName lastName fullName admissionNumber" },
          { path: "programId", select: "title shortTitle name code" },
        ],
      }),
      findSafe(Payment, paymentMongo, null, {
        sort: { paymentDate: -1, createdAt: -1 },
        limit: 8,
        populate: [{ path: "studentId", select: "firstName middleName lastName fullName admissionNumber" }],
      }),
      findSafe(Expense, expenseMongo, null, {
        sort: { expenseDate: -1, createdAt: -1 },
        limit: 8,
      }),
    ]);

    const invoiceTotals = sumInvoices(invoiceDocs);
    const totalCollected = paymentDocs.reduce((a, p) => a + paymentAmount(p), 0);
    const totalExpenses = expenseDocs.reduce((a, e) => a + expenseAmount(e), 0);

    const unpaidInvoices = invoiceDocs.filter((inv) => invoiceBalance(inv) > 0).length;
    const paidInvoices = invoiceDocs.filter((inv) => invoiceBalance(inv) <= 0).length;
    const partialInvoices = invoiceDocs.filter((inv) => invoicePaid(inv) > 0 && invoiceBalance(inv) > 0).length;

    const paymentMethods = groupPaymentsByMethod(paymentDocs);
    const expenseCategories = groupExpensesByCategory(expenseDocs);

    const financeData = {
      totals: {
        students: studentCount,
        programs: programCount,
        invoices: invoiceDocs.length,
        payments: paymentDocs.length,
        feeStructures: feeStructureCount,
        scholarships: scholarshipCount,
        expenses: expenseDocs.length,
        billed: invoiceTotals.billed,
        collected: totalCollected,
        outstanding: invoiceTotals.balance,
        expenseTotal: totalExpenses,
        netPosition: totalCollected - totalExpenses,
        paidInvoices,
        unpaidInvoices,
        partialInvoices,
      },
      charts: {
        paymentMethods,
        expenseCategories,
      },
      recent: {
        invoices: recentInvoicesRaw.map(serializeRecentInvoice),
        payments: recentPaymentsRaw.map(serializeRecentPayment),
        expenses: recentExpensesRaw.map(serializeRecentExpense),
      },
      availableModels: {
        Student: modelExists(req, "Student"),
        Program: modelExists(req, "Subject") || modelExists(req, "Program"),
        Invoice: modelExists(req, "Invoice"),
        Payment: modelExists(req, "Payment"),
        FeeStructure: modelExists(req, "FeeStructure"),
        Scholarship: modelExists(req, "Scholarship"),
        Expense: modelExists(req, "Expense"),
      },
    };

    return res.render("tenant/finance/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      finance: financeData,
      query: clean,
      programs: (programOptions || []).map((p) => ({
        id: String(p._id),
        name: getProgramName(p),
      })),
      pageTitle: "Finance",
    });
  },
};
