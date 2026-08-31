const { getParent, canAccessChild } = require("./_helpers");
const { isValidId, safeAmount } = require("../../../services/tenant/financeService");
const { accountSnapshot, liveInvoiceStatus } = require("../../../services/tenant/financeVisibilityService");

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function normalizeInvoiceRows(rows = []) {
  return rows.map((r) => {
    const amount = safeAmount(r.totalAmount);
    const paid = safeAmount(r.paidAmount);
    const balance = Math.max(0, safeAmount(r.balance));
    return {
      ...r,
      title: r.items?.[0]?.title || r.reference || r.invoiceNumber || "School Fees",
      category: r.items?.[0]?.category || "General",
      academicYear: r.academicYear || "—",
      term: r.term || "—",
      semester: r.term || "—",
      dueDate: fmtDate(r.dueDate),
      amount,
      paid,
      balance,
      status: liveInvoiceStatus(r).toLowerCase(),
      reference: r.invoiceNumber || r.reference || "—",
      notes: r.notes || "—",
    };
  });
}

function normalizePayments(rows = []) {
  return rows.map((r) => ({
    ...r,
    amount: safeAmount(r.amount),
    date: fmtDate(r.paymentDate || r.createdAt),
    method: r.method || "—",
    reference: r.reference || r.receiptNumber || "—",
    status: r.status || "Pending",
    notes: r.notes || "—",
    receiptUrl: `/parent/fees/receipts/${r._id}`,
  }));
}

function buildFeeSummary(rawInvoices = [], rawPayments = []) {
  const snapshot = accountSnapshot(rawInvoices, rawPayments);
  const rows = normalizeInvoiceRows(rawInvoices).filter((x) => String(x.status).toLowerCase() !== "cancelled");
  return {
    billed: snapshot.billed,
    paid: snapshot.paid,
    applied: snapshot.applied,
    invoiceOutstanding: snapshot.invoiceOutstanding,
    unallocatedCredit: snapshot.unallocatedCredit,
    balance: snapshot.balance,
    credit: snapshot.credit,
    overdueCount: rows.filter((x) => x.status === "overdue").length,
    paidItems: rows.filter((x) => x.status === "paid").length,
    partialItems: rows.filter((x) => x.status === "partially paid").length,
    unpaidItems: rows.filter((x) => ["unpaid", "overdue"].includes(x.status)).length,
  };
}

async function parentContext(req) {
  const { Student } = req.models || {};
  const { user, parent } = await getParent(req);
  if (!user) return { user: null, parent, children: [], student: null };
  const childIds = Array.isArray(parent?.childrenStudentIds) ? parent.childrenStudentIds : [];
  const children = parent && Student && childIds.length
    ? await Student.find({ _id: { $in: childIds }, isDeleted: { $ne: true }, status: { $ne: "archived" } })
      .select("firstName lastName middleName fullName regNo studentNo programId classId className classLevel schoolLevel academicYear term status")
      .populate({ path: "programId", select: "code name title" })
      .sort({ firstName: 1, lastName: 1 }).lean()
    : [];
  const requested = req.query?.student ? String(req.query.student) : null;
  let student = requested && canAccessChild(parent, requested) ? children.find((c) => String(c._id) === requested) || null : null;
  if (!student && children.length) student = children[0];
  return { user, parent, children, student };
}

module.exports = {
  async index(req, res) {
    try {
      const { Invoice, Payment } = req.models || {};
      const { user, parent, children, student } = await parentContext(req);
      if (!user) return res.redirect("/login");
      if (!Invoice || !Payment) return res.status(503).send("Parent finance is unavailable.");
      res.set("Cache-Control", "private, no-store");
      if (!student) {
        return res.render("parents/fees", { tenant: req.tenant, user, parent, children, student: null, invoices: [], payments: [], summary: buildFeeSummary(), error: "No linked student found for this parent account." });
      }

      const [rawInvoices, rawPayments] = await Promise.all([
        Invoice.find({ studentId: student._id, isDeleted: { $ne: true }, status: { $ne: "Draft" } }).sort({ dueDate: 1, issueDate: -1, createdAt: -1 }).lean(),
        Payment.find({ studentId: student._id, isDeleted: { $ne: true } }).sort({ paymentDate: -1, createdAt: -1 }).lean(),
      ]);
      const invoices = normalizeInvoiceRows(rawInvoices);
      const payments = normalizePayments(rawPayments);
      return res.render("parents/fees", {
        tenant: req.tenant, user, parent, children, student, invoices, payments,
        summary: buildFeeSummary(rawInvoices, rawPayments), error: null,
      });
    } catch (err) {
      console.error("PARENT FEES ERROR:", err);
      return res.status(500).send("Failed to load parent fees page");
    }
  },

  async receipt(req, res) {
    try {
      const { Payment } = req.models || {};
      if (!Payment || !isValidId(req.params.id)) return res.status(404).send("Receipt not found");
      const { user, children } = await parentContext(req);
      if (!user) return res.redirect("/login");
      const allowedIds = new Set(children.map((c) => String(c._id)));
      const payment = await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
        .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
        .populate({ path: "invoiceId", populate: { path: "studentId", select: "firstName middleName lastName fullName admissionNumber regNo" } });
      if (!payment || !allowedIds.has(String(payment.studentId?._id || payment.studentId || ""))) return res.status(404).send("Receipt not found");
      res.set("Cache-Control", "private, no-store");
      return res.render("tenant/finance/receipts/view", { tenant: req.tenant, payment, invoice: payment.invoiceId || null, receiptStatus: payment.status });
    } catch (_) {
      return res.status(404).send("Receipt not found");
    }
  },

  _private: { normalizeInvoiceRows, normalizePayments, buildFeeSummary, parentContext },
};
