const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
} = require("./_helpers");

module.exports = {
  finance: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Invoice, Payment, FeeStructure, Receipt } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        {
          tenant: req.tenant,
          user,
          student,
          currentPath: req.originalUrl,
          pageTitle: "Student Finance",
        },
        "students/finance"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const invoices = Invoice
        ? await Invoice.find({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const payments = Payment
        ? await Payment.find({
            $or: [{ studentId: student._id }, { userId: user._id }],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const feeItems = FeeStructure
        ? await FeeStructure.find({
            $or: [
              { studentId: student._id },
              { programId: student.programId || null },
              { classId: student.classId || null },
              { level: student.level || null },
            ],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const receipts = Receipt
        ? await Receipt.find({
            $or: [{ studentId: student._id }, { userId: user._id }],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const totals = {
        billed:
          invoices.reduce((s, i) => s + num(i.amount ?? i.total ?? i.amountDue), 0) ||
          feeItems.reduce((s, f) => s + num(f.amount ?? f.total ?? f.value), 0),
        paid: payments.reduce((s, p) => s + num(p.amount ?? p.paidAmount), 0),
        balance: invoices.reduce((s, i) => s + num(i.balance ?? i.amountDue ?? 0), 0),
      };

      const breakdown = feeItems.length
        ? feeItems.map((item) => ({
            item: item.name || item.title || item.item || "Fee item",
            description: item.description || item.notes || meta.program,
            amount: num(item.amount ?? item.total ?? item.value),
            status: item.status || "billed",
          }))
        : invoices.map((inv) => ({
            item: inv.category || inv.type || inv.title || "Invoice",
            description: inv.description || inv.notes || inv.invoiceNo || "Student finance item",
            amount: num(inv.amount ?? inv.total ?? inv.amountDue),
            status: inv.status || "pending",
          }));

      const recentInvoices = invoices.slice(0, 10).map((inv) => ({
        id: String(inv._id),
        number: inv.invoiceNo || inv.number || inv.reference || "-",
        date: inv.createdAt || inv.invoiceDate || inv.date || null,
        amount: num(inv.amount ?? inv.total ?? inv.amountDue),
        balance: num(inv.balance ?? inv.amountDue ?? 0),
        status: inv.status || "pending",
      }));

      const paymentHistory = payments.slice(0, 20).map((p) => ({
        id: String(p._id),
        date: p.createdAt || p.date || p.paidAt || null,
        amount: num(p.amount ?? p.paidAmount),
        method: p.method || p.paymentMethod || "Payment",
        reference: p.reference || p.txRef || p.receiptNo || "-",
        status: p.status || "posted",
      }));

      const recentReceipts = receipts.slice(0, 10).map((r) => ({
        id: String(r._id),
        number: r.receiptNo || r.number || r.reference || "-",
        date: r.createdAt || r.date || null,
        amount: num(r.amount ?? r.total),
      }));

      return renderView(req, res, "students/finance", {
        pageTitle: "Student Finance",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        totals,
        breakdown,
        recentInvoices,
        paymentHistory,
        recentReceipts,
      });
    } catch (err) {
      return res.status(500).send("Failed to load finance: " + err.message);
    }
  },
};