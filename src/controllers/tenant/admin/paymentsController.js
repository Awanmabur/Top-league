const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function makeReceiptNo() {
  return `RCPT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
}

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

function paymentAmount(p) {
  return Number(p.amount || 0);
}

function normalizeInvoiceStatus(invoice) {
  if (!invoice) return "Unpaid";
  if (invoice.status === "Cancelled") return "Cancelled";
  if (invoice.status === "Draft") return "Draft";

  const total = Number(invoice.totalAmount || 0);
  const paid = Number(invoice.paidAmount || 0);
  const balance =
    invoice.balance !== undefined && invoice.balance !== null
      ? Number(invoice.balance || 0)
      : Math.max(0, total - paid);

  if (balance <= 0 && total > 0) return "Paid";
  if (paid > 0 && balance > 0) return "Partially Paid";
  return "Unpaid";
}

async function recalcInvoice(Invoice, invoiceId, actorId) {
  if (!Invoice || !isValidId(invoiceId)) return null;

  const invoice = await Invoice.findOne({
    _id: invoiceId,
    isDeleted: { $ne: true },
  });

  if (!invoice) return null;

  const Payment = Invoice.db.models.Payment;
  const activePayments = await Payment.find({
    invoiceId: invoice._id,
    isDeleted: { $ne: true },
    status: { $nin: ["Voided", "Refunded"] },
  }).lean();

  const paidAmount = activePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalAmount = Number(invoice.totalAmount || 0);
  const balance = Math.max(0, totalAmount - paidAmount);

  invoice.paidAmount = paidAmount;
  invoice.balance = balance;
  invoice.status = normalizeInvoiceStatus({
    ...invoice.toObject(),
    paidAmount,
    balance,
  });
  invoice.updatedBy = actorId || null;

  await invoice.save();
  return invoice;
}

function serializeInvoice(inv) {
  const student = inv.studentId || inv.student || null;
  const program = inv.programId || inv.program || null;

  const totalAmount = Number(inv.totalAmount || 0);
  const paidAmount = Number(inv.paidAmount || 0);
  const balance =
    inv.balance !== undefined && inv.balance !== null
      ? Number(inv.balance || 0)
      : Math.max(0, totalAmount - paidAmount);

  return {
    id: String(inv._id),
    invoiceNo: inv.invoiceNumber || "—",
    studentId: student?._id ? String(student._id) : String(inv.studentId?._id || inv.studentId || ""),
    studentName: getStudentName(student),
    programId: program?._id ? String(program._id) : String(inv.programId?._id || inv.programId || ""),
    programName: getProgramName(program),
    totalAmount,
    paidAmount,
    balance,
    status: normalizeInvoiceStatus(inv),
    issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : "",
    dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : "",
  };
}

function serializePayment(doc) {
  const student = doc.studentId || doc.student || null;
  const invoice = doc.invoiceId || doc.invoice || null;
  const program = doc.programId || doc.program || null;

  return {
    id: String(doc._id),
    receiptNo: doc.receiptNumber || "—",
    reference: doc.reference || "",
    studentId: student?._id ? String(student._id) : String(doc.studentId?._id || doc.studentId || ""),
    studentName: getStudentName(student),
    invoiceId: invoice?._id ? String(invoice._id) : String(doc.invoiceId?._id || doc.invoiceId || ""),
    invoiceNo: invoice?.invoiceNumber || "Unallocated",
    programId: program?._id ? String(program._id) : String(doc.programId?._id || doc.programId || ""),
    programName: getProgramName(program),
    amount: Number(doc.amount || 0),
    method: doc.method || "Cash",
    status: doc.status || "Completed",
    paymentDate: doc.paymentDate ? new Date(doc.paymentDate).toISOString().slice(0, 10) : "",
    term: doc.term || "",
    academicYear: doc.academicYear || "",
    notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  const completed = list.filter((x) => x.status === "Completed").length;
  const pending = list.filter((x) => x.status === "Pending").length;
  const voided = list.filter((x) => x.status === "Voided").length;
  const refunded = list.filter((x) => x.status === "Refunded").length;

  const collected = list
    .filter((x) => !["Voided", "Refunded"].includes(x.status))
    .reduce((sum, x) => sum + Number(x.amount || 0), 0);

  const byMethod = {};
  list
    .filter((x) => !["Voided", "Refunded"].includes(x.status))
    .forEach((x) => {
      const key = x.method || "Cash";
      byMethod[key] = (byMethod[key] || 0) + Number(x.amount || 0);
    });

  return {
    total: list.length,
    completed,
    pending,
    voided,
    refunded,
    collected,
    methods: Object.keys(byMethod).map((k) => ({ label: k, amount: byMethod[k] })),
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const method = str(query.method || "all");
  const student = str(query.student || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;
  if (method !== "all") mongo.method = method;
  if (student !== "all" && isValidId(student)) mongo.studentId = student;

  if (q) {
    mongo.$or = [
      { receiptNumber: new RegExp(q, "i") },
      { reference: new RegExp(q, "i") },
      { method: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
      { term: new RegExp(q, "i") },
      { academicYear: new RegExp(q, "i") },
      { notes: new RegExp(q, "i") },
    ];
  }

  return {
    mongo,
    clean: { q, status, method, student, view },
  };
}

module.exports = {
  /**
   * GET /admin/payments
   */
  index: async (req, res) => {
    const { Payment, Student, Invoice, Program } = req.models;

    const { mongo, clean } = buildFilters(req.query);

    const [paymentDocs, studentDocs, invoiceDocs, programDocs] = await Promise.all([
      Payment.find(mongo)
        .populate("studentId", "firstName middleName lastName fullName admissionNumber")
        .populate("invoiceId", "invoiceNumber totalAmount paidAmount balance status issueDate dueDate")
        .populate("programId", "name title code")
        .sort({ paymentDate: -1, createdAt: -1 })
        .lean(),
      Student
        ? Student.find({})
            .select("firstName middleName lastName fullName admissionNumber")
            .sort({ createdAt: -1 })
            .lean()
        : [],
      Invoice
        ? Invoice.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .populate("programId", "name title code")
            .sort({ createdAt: -1 })
            .lean()
        : [],
      Program
        ? Program.find({})
            .select("name title code")
            .sort({ name: 1, title: 1 })
            .lean()
        : [],
    ]);

    const payments = paymentDocs.map(serializePayment);
    const invoices = invoiceDocs.map(serializeInvoice);
    const kpis = computeKpis(payments);

    return res.render("tenant/finance/payments", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      payments,
      invoices,
      kpis,
      students: (studentDocs || []).map((s) => ({
        id: String(s._id),
        name: getStudentName(s),
      })),
      programs: (programDocs || []).map((p) => ({
        id: String(p._id),
        name: getProgramName(p),
      })),
      query: clean,
    });
  },

  /**
   * POST /admin/payments
   */
  create: async (req, res) => {
    const { Payment, Invoice } = req.models;

    const studentId = str(req.body.studentId);
    const invoiceId = str(req.body.invoiceId);
    const programId = str(req.body.programId);
    const reference = str(req.body.reference);
    const amount = Math.max(0, asNum(req.body.amount, 0));
    const method = str(req.body.method || "Cash");
    const status = str(req.body.status || "Completed");
    const paymentDate = asDate(req.body.paymentDate) || new Date();
    const term = str(req.body.term);
    const academicYear = str(req.body.academicYear);
    const notes = str(req.body.notes);

    if (!isValidId(studentId)) {
      req.flash?.("error", "Student is required.");
      return res.redirect("/admin/payments");
    }

    if (!(amount > 0)) {
      req.flash?.("error", "Payment amount must be greater than zero.");
      return res.redirect("/admin/payments");
    }

    let invoice = null;
    if (isValidId(invoiceId)) {
      invoice = await Invoice.findOne({
        _id: invoiceId,
        isDeleted: { $ne: true },
      });

      if (!invoice) {
        req.flash?.("error", "Selected invoice was not found.");
        return res.redirect("/admin/payments");
      }
    }

    const payment = await Payment.create({
      receiptNumber: makeReceiptNo(),
      reference,
      studentId,
      invoiceId: invoice ? invoice._id : null,
      programId: isValidId(programId) ? programId : invoice?.programId || null,
      amount,
      method,
      status,
      paymentDate,
      term,
      academicYear,
      notes,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    if (invoice && !["Voided", "Refunded"].includes(status)) {
      await recalcInvoice(Invoice, invoice._id, actorUserId(req));
    }

    req.flash?.("success", "Payment recorded successfully.");
    return res.redirect("/admin/payments");
  },

  /**
   * POST /admin/payments/:id/update
   */
  update: async (req, res) => {
    const { Payment, Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payment ID.");
      return res.redirect("/admin/payments");
    }

    const existing = await Payment.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!existing) {
      req.flash?.("error", "Payment not found.");
      return res.redirect("/admin/payments");
    }

    const oldInvoiceId = existing.invoiceId ? String(existing.invoiceId) : null;

    const studentId = str(req.body.studentId);
    const invoiceId = str(req.body.invoiceId);
    const programId = str(req.body.programId);
    const reference = str(req.body.reference);
    const amount = Math.max(0, asNum(req.body.amount, 0));
    const method = str(req.body.method || "Cash");
    const status = str(req.body.status || "Completed");
    const paymentDate = asDate(req.body.paymentDate) || existing.paymentDate || new Date();
    const term = str(req.body.term);
    const academicYear = str(req.body.academicYear);
    const notes = str(req.body.notes);

    if (!isValidId(studentId)) {
      req.flash?.("error", "Student is required.");
      return res.redirect("/admin/payments");
    }

    if (!(amount > 0)) {
      req.flash?.("error", "Payment amount must be greater than zero.");
      return res.redirect("/admin/payments");
    }

    let invoice = null;
    if (isValidId(invoiceId)) {
      invoice = await Invoice.findOne({
        _id: invoiceId,
        isDeleted: { $ne: true },
      });

      if (!invoice) {
        req.flash?.("error", "Selected invoice was not found.");
        return res.redirect("/admin/payments");
      }
    }

    existing.studentId = studentId;
    existing.invoiceId = invoice ? invoice._id : null;
    existing.programId = isValidId(programId) ? programId : invoice?.programId || null;
    existing.reference = reference;
    existing.amount = amount;
    existing.method = method;
    existing.status = status;
    existing.paymentDate = paymentDate;
    existing.term = term;
    existing.academicYear = academicYear;
    existing.notes = notes;
    existing.updatedBy = actorUserId(req);

    await existing.save();

    if (oldInvoiceId) {
      await recalcInvoice(Invoice, oldInvoiceId, actorUserId(req));
    }
    if (invoice) {
      await recalcInvoice(Invoice, invoice._id, actorUserId(req));
    }

    req.flash?.("success", "Payment updated successfully.");
    return res.redirect("/admin/payments");
  },

  /**
   * POST /admin/payments/:id/void
   */
  void: async (req, res) => {
    const { Payment, Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payment ID.");
      return res.redirect("/admin/payments");
    }

    const payment = await Payment.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!payment) {
      req.flash?.("error", "Payment not found.");
      return res.redirect("/admin/payments");
    }

    payment.status = "Voided";
    payment.updatedBy = actorUserId(req);
    await payment.save();

    if (payment.invoiceId) {
      await recalcInvoice(Invoice, payment.invoiceId, actorUserId(req));
    }

    req.flash?.("success", "Payment voided.");
    return res.redirect("/admin/payments");
  },

  /**
   * POST /admin/payments/:id/delete
   */
  delete: async (req, res) => {
    const { Payment, Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payment ID.");
      return res.redirect("/admin/payments");
    }

    const payment = await Payment.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!payment) {
      req.flash?.("error", "Payment not found.");
      return res.redirect("/admin/payments");
    }

    const linkedInvoiceId = payment.invoiceId ? String(payment.invoiceId) : null;

    payment.isDeleted = true;
    payment.deletedAt = new Date();
    payment.updatedBy = actorUserId(req);
    await payment.save();

    if (linkedInvoiceId) {
      await recalcInvoice(Invoice, linkedInvoiceId, actorUserId(req));
    }

    req.flash?.("success", "Payment deleted.");
    return res.redirect("/admin/payments");
  },

  /**
   * POST /admin/payments/bulk
   */
  bulkAction: async (req, res) => {
    const { Payment, Invoice } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No payments selected.");
      return res.redirect("/admin/payments");
    }

    const action = str(req.body.action);
    const docs = await Payment.find({
      _id: { $in: ids },
      isDeleted: { $ne: true },
    });

    if (!docs.length) {
      req.flash?.("error", "No valid payments found.");
      return res.redirect("/admin/payments");
    }

    const invoiceIds = new Set();

    for (const doc of docs) {
      if (action === "void") doc.status = "Voided";
      if (action === "pending") doc.status = "Pending";
      if (action === "complete") doc.status = "Completed";
      if (action === "delete") {
        doc.isDeleted = true;
        doc.deletedAt = new Date();
      }
      doc.updatedBy = actorUserId(req);
      if (doc.invoiceId) invoiceIds.add(String(doc.invoiceId));
      await doc.save();
    }

    for (const invoiceId of invoiceIds) {
      await recalcInvoice(Invoice, invoiceId, actorUserId(req));
    }

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/payments");
  },
};