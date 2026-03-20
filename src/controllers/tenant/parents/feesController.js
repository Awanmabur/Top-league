const { getParent, canAccessChild } = require("./_helpers");

function num(v) {
  return Number(v || 0);
}

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}

function normalizeInvoiceRows(rows = []) {
  return rows.map((r) => {
    const amount = num(r.amount || r.totalAmount || r.billAmount || r.expectedAmount);
    const paid = num(r.paidAmount || r.amountPaid || r.settledAmount);
    const balance = Math.max(0, num(r.balance || r.balanceAmount || (amount - paid)));

    return {
      ...r,
      title: r.title || r.name || r.feeItem || r.description || "Fee Item",
      category: r.category || r.type || r.feeType || "General",
      academicYear: r.academicYear || "—",
      semester: r.semester || "—",
      dueDate: fmtDate(r.dueDate || r.deadline || r.dateDue),
      amount,
      paid,
      balance,
      status:
        r.status ||
        (balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid"),
      reference: r.reference || r.invoiceNo || r.invoiceNumber || r.code || "—",
      notes: r.notes || r.remarks || "—",
    };
  });
}

function normalizePayments(rows = []) {
  return rows.map((r) => {
    const amount = num(r.amount || r.amountPaid || r.total);
    return {
      ...r,
      amount,
      date: fmtDate(r.paymentDate || r.date || r.createdAt),
      method: r.method || r.paymentMethod || "—",
      reference: r.reference || r.receiptNo || r.transactionId || r.paymentRef || "—",
      status: r.status || "completed",
      notes: r.notes || r.remarks || "—",
    };
  });
}

function buildFeeSummary(invoices = [], payments = []) {
  const billed = invoices.reduce((sum, x) => sum + num(x.amount), 0);
  const invoicePaid = invoices.reduce((sum, x) => sum + num(x.paid), 0);
  const paymentTotal = payments.reduce((sum, x) => sum + num(x.amount), 0);

  const paid = Math.max(invoicePaid, paymentTotal);
  const balance = Math.max(0, billed - paid);

  const overdueCount = invoices.filter(
    (x) => String(x.status || "").toLowerCase() !== "paid" && x.dueDate && x.dueDate !== "—"
  ).length;

  const paidItems = invoices.filter((x) => String(x.status || "").toLowerCase() === "paid").length;
  const partialItems = invoices.filter((x) => String(x.status || "").toLowerCase() === "partial").length;
  const unpaidItems = invoices.filter((x) => String(x.status || "").toLowerCase() === "unpaid").length;

  return {
    billed,
    paid,
    balance,
    overdueCount,
    paidItems,
    partialItems,
    unpaidItems,
  };
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-FEES] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Student, FeeInvoice, FeePayment, Payment, Fee, Invoice } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select(
                "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status"
              )
              .populate({ path: "program", select: "code name title level faculty" })
              .populate({ path: "classGroup", select: "code name title" })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      const selectedStudentId = req.query?.student ? String(req.query.student) : null;

      let student = null;
      if (selectedStudentId && canAccessChild(parent, selectedStudentId)) {
        student = children.find((c) => String(c._id) === selectedStudentId) || null;
      }
      if (!student && children.length) student = children[0];

      if (!student) {
        return res.render("tenant/parent/fees", {
          tenant: req.tenant,
          user,
          parent,
          children,
          student: null,
          invoices: [],
          payments: [],
          summary: {
            billed: 0,
            paid: 0,
            balance: 0,
            overdueCount: 0,
            paidItems: 0,
            partialItems: 0,
            unpaidItems: 0,
          },
          error: "No linked student found for this parent account.",
        });
      }

      const invoiceModel = FeeInvoice || Fee || Invoice || null;
      const paymentModel = FeePayment || Payment || null;

      const rawInvoices = invoiceModel
        ? await invoiceModel
            .find({
              deletedAt: null,
              $or: [{ student: student._id }, { studentId: student._id }],
            })
            .sort({ dueDate: 1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const rawPayments = paymentModel
        ? await paymentModel
            .find({
              deletedAt: null,
              $or: [{ student: student._id }, { studentId: student._id }],
            })
            .sort({ paymentDate: -1, date: -1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const invoices = normalizeInvoiceRows(rawInvoices);
      const payments = normalizePayments(rawPayments);
      const summary = buildFeeSummary(invoices, payments);

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? { id: parent._id, email: parent.email, kids: (parent.childrenStudentIds || []).length }
          : null
      );
      log("children:", children.length);
      log("selectedStudent:", student ? String(student._id) : null);
      log("invoices:", invoices.length);
      log("payments:", payments.length);

      return res.render("tenant/parent/fees", {
        tenant: req.tenant,
        user,
        parent,
        children,
        student,
        invoices,
        payments,
        summary,
        error: null,
      });
    } catch (err) {
      console.error("PARENT FEES ERROR:", err);
      return res.status(500).send("Failed to load parent fees page");
    }
  },
};