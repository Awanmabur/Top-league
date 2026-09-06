const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");
const { isValidId, safeAmount } = require("../../../services/tenant/financeService");
const {
  accountSnapshot,
  liveInvoiceStatus,
  academicPeriodValues,
  periodMatches,
} = require("../../../services/tenant/financeVisibilityService");

function cleanFilter(value) {
  const v = String(value || "all").trim().slice(0, 30);
  return v || "all";
}

module.exports = {
  finance: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");
      const { Invoice, Payment } = req.models;
      if (!Invoice || !Payment) return res.status(503).send("Student finance is unavailable.");

      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(res, {
        tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Student Finance",
      }, "students/finance");
      if (blocked) return blocked;

      res.set("Cache-Control", "private, no-store");
      const meta = academicMeta(student);
      meta.semester = student?.term ? `Term ${student.term}` : "Current Term";

      const [allInvoices, allPayments] = await Promise.all([
        Invoice.find({ studentId: student._id, isDeleted: { $ne: true }, status: { $ne: "Draft" } })
          .sort({ issueDate: -1, createdAt: -1 }).lean(),
        Payment.find({ studentId: student._id, isDeleted: { $ne: true } })
          .sort({ paymentDate: -1, createdAt: -1 }).lean(),
      ]);

      const periodOptions = academicPeriodValues([...(allInvoices || []), ...(allPayments || [])]);
      const filters = {
        academicYear: cleanFilter(req.query?.academicYear),
        term: cleanFilter(req.query?.term),
      };
      const invoices = (allInvoices || []).filter((row) => periodMatches(row, filters));
      const payments = (allPayments || []).filter((row) => periodMatches(row, filters));
      const totals = accountSnapshot(invoices, payments);

      const breakdown = totals.activeInvoices.flatMap((inv) => (Array.isArray(inv.items) ? inv.items : []).map((item) => ({
        item: item.title || "Fee item",
        description: item.note || `${inv.invoiceNumber || "Invoice"}${inv.academicYear ? ` • ${inv.academicYear}` : ""}${inv.term ? ` • ${inv.term}` : ""}`,
        amount: safeAmount(item.amount ?? safeAmount(item.qty, 1) * safeAmount(item.unitAmount)),
        status: liveInvoiceStatus(inv),
      })));

      const recentInvoices = invoices.slice(0, 20).map((inv) => ({
        id: String(inv._id),
        number: inv.invoiceNumber || inv.reference || "-",
        date: inv.issueDate || inv.createdAt || null,
        amount: safeAmount(inv.totalAmount),
        balance: safeAmount(inv.balance),
        status: liveInvoiceStatus(inv),
      }));

      const paymentHistory = payments.slice(0, 30).map((p) => ({
        id: String(p._id),
        date: p.paymentDate || p.createdAt || null,
        amount: safeAmount(p.amount),
        method: p.method || "Payment",
        reference: p.reference || p.receiptNumber || "-",
        receiptNumber: p.receiptNumber || "-",
        status: p.status || "Pending",
        receiptUrl: `/student/finance/receipts/${p._id}`,
      }));

      const recentReceipts = totals.completedPayments.slice(0, 10).map((p) => ({
        id: String(p._id),
        number: p.receiptNumber || "-",
        date: p.paymentDate || p.createdAt || null,
        amount: safeAmount(p.amount),
        url: `/student/finance/receipts/${p._id}`,
      }));

      return renderView(req, res, "students/finance", {
        pageTitle: "Student Finance", user, student, studentName: getStudentDisplayName(student, user),
        meta, totals, breakdown, recentInvoices, paymentHistory, recentReceipts, filters, periodOptions,
      });
    } catch (err) {
      console.error("Student finance load error:", err);
      return res.status(500).send("Failed to load finance.");
    }
  },

  receipt: async (req, res) => {
    try {
      const { Payment } = req.models || {};
      const got = await getStudent(req);
      const student = got?.student || null;
      if (!student || !Payment || !isValidId(req.params.id)) return res.status(404).send("Receipt not found");
      const payment = await Payment.findOne({ _id: req.params.id, studentId: student._id, isDeleted: { $ne: true } })
        .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
        .populate({ path: "invoiceId", populate: { path: "studentId", select: "firstName middleName lastName fullName admissionNumber regNo" } });
      if (!payment) return res.status(404).send("Receipt not found");
      res.set("Cache-Control", "private, no-store");
      return res.render("tenant/finance/receipts/view", { tenant: req.tenant, payment, invoice: payment.invoiceId || null, receiptStatus: payment.status });
    } catch (_) {
      return res.status(404).send("Receipt not found");
    }
  },
};
