const {
  str,
  isValidId,
  escapeRegex,
  csvCell,
  safeAmount,
  normalizePaymentMethod,
  normalizePaymentStatus,
  deriveInvoiceStatus,
  createPayment,
  completePendingPayment,
  transitionPayment,
} = require("../../../services/tenant/financeService");
const { assertProgramAssignment } = require("../../../services/tenant/organizationCatalogService");

const actorUserId = (req) => req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function getStudentName(st) {
  if (!st) return "—";
  return st.fullName || [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") || st.name || st.regNo || st.admissionNumber || "—";
}

function getProgramName(p) {
  if (!p) return "—";
  return p.title || p.shortTitle || p.name || p.programName || p.code || "—";
}

function serializeInvoice(inv) {
  const student = inv.studentId || null;
  const program = inv.programId || null;
  const totalAmount = Number(inv.totalAmount || 0);
  const paidAmount = Number(inv.paidAmount || 0);
  const balance = Math.max(0, Number(inv.balance ?? totalAmount - paidAmount));
  return {
    id: String(inv._id), invoiceNo: inv.invoiceNumber || "—",
    studentId: student?._id ? String(student._id) : String(inv.studentId?._id || inv.studentId || ""),
    studentName: getStudentName(student),
    programId: program?._id ? String(program._id) : String(inv.programId?._id || inv.programId || ""),
    programName: getProgramName(program), totalAmount, paidAmount, balance,
    status: deriveInvoiceStatus({ totalAmount, paidAmount, dueDate: inv.dueDate, status: inv.status }),
    issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : "",
    dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : "",
  };
}

function serializePayment(doc) {
  const student = doc.studentId || null;
  const invoice = doc.invoiceId || null;
  const program = doc.programId || null;
  return {
    id: String(doc._id), receiptNo: doc.receiptNumber || "—", reference: doc.reference || "",
    studentId: student?._id ? String(student._id) : String(doc.studentId?._id || doc.studentId || ""),
    studentName: getStudentName(student),
    invoiceId: invoice?._id ? String(invoice._id) : String(doc.invoiceId?._id || doc.invoiceId || ""),
    invoiceNo: invoice?.invoiceNumber || "Unallocated",
    programId: program?._id ? String(program._id) : String(doc.programId?._id || doc.programId || ""),
    programName: getProgramName(program), amount: Number(doc.amount || 0), method: doc.method || "Other",
    status: doc.status || "Pending", paymentDate: doc.paymentDate ? new Date(doc.paymentDate).toISOString().slice(0, 10) : "",
    term: doc.term || "", academicYear: doc.academicYear || "", notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  const live = list.filter((x) => x.status === "Completed");
  const byMethod = {};
  live.forEach((x) => { const k = x.method || "Other"; byMethod[k] = (byMethod[k] || 0) + Number(x.amount || 0); });
  return {
    total: list.length,
    completed: list.filter((x) => x.status === "Completed").length,
    pending: list.filter((x) => x.status === "Pending").length,
    voided: list.filter((x) => x.status === "Voided").length,
    refunded: list.filter((x) => x.status === "Refunded").length,
    collected: live.reduce((sum, x) => sum + Number(x.amount || 0), 0),
    methods: Object.entries(byMethod).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount),
  };
}

function buildFilters(query = {}) {
  const q = str(query.q, 120);
  const status = str(query.status || "all", 40);
  const method = str(query.method || "all", 40);
  const student = str(query.student || "all", 80);
  const view = str(query.view || "list", 20) || "list";
  const mongo = { isDeleted: { $ne: true } };
  if (status !== "all") mongo.status = status;
  if (method !== "all") mongo.method = method;
  if (student !== "all" && isValidId(student)) mongo.studentId = student;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { receiptNumber: rx }, { reference: rx }, { method: rx }, { status: rx },
      { term: rx }, { academicYear: rx }, { notes: rx },
    ];
  }
  return { mongo, clean: { q, status, method, student, view } };
}

async function studentExists(Student, id) {
  return !!(Student && isValidId(id) && await Student.exists({ _id: id }));
}

module.exports = {
  index: async (req, res) => {
    const { Payment, Student, Invoice, Subject, Program } = req.models;
    const AcademicProgram = Program || Subject || null;
    const { mongo, clean } = buildFilters(req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 50;
    const [totalCount, paymentDocs, kpiDocs, studentDocs, invoiceDocs, programDocs] = await Promise.all([
      Payment.countDocuments(mongo),
      Payment.find(mongo).populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
        .populate("invoiceId", "invoiceNumber totalAmount paidAmount balance status issueDate dueDate studentId")
        .populate("programId", "title shortTitle name code").sort({ paymentDate: -1, createdAt: -1 })
        .skip((page - 1) * perPage).limit(perPage).lean(),
      Payment.find(mongo).select("amount method status").lean(),
      Student ? Student.find({}).select("firstName middleName lastName fullName admissionNumber regNo").sort({ createdAt: -1 }).limit(4000).lean() : [],
      Invoice ? Invoice.find({ isDeleted: { $ne: true }, status: { $nin: ["Draft", "Cancelled"] } })
        .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
        .populate("programId", "title shortTitle name code").sort({ createdAt: -1 }).limit(4000).lean() : [],
      AcademicProgram ? AcademicProgram.find({}).select("title shortTitle name code").sort({ title: 1, shortTitle: 1, name: 1, code: 1 }).lean() : [],
    ]);
    const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);
    const safePage = Math.min(page, totalPages);
    return res.render("tenant/finance/payments", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      payments: paymentDocs.map(serializePayment),
      invoices: invoiceDocs.map(serializeInvoice),
      kpis: computeKpis(kpiDocs.map((x) => ({ status: x.status || "Pending", method: x.method || "Other", amount: Number(x.amount || 0) }))),
      students: studentDocs.map((s) => ({ id: String(s._id), name: getStudentName(s) })),
      programs: programDocs.map((p) => ({ id: String(p._id), name: getProgramName(p) })),
      query: { ...clean, page: safePage, perPage, total: totalCount, totalPages },
    });
  },

  create: async (req, res) => {
    const { Student } = req.models;
    try {
      const studentId = str(req.body.studentId, 80);
      if (!(await studentExists(Student, studentId))) throw new Error("Select a valid student.");
      await createPayment(req.models, {
        studentId,
        invoiceId: req.body.invoiceId,
        programId: req.body.programId,
        reference: req.body.reference,
        amount: req.body.amount,
        method: req.body.method,
        status: normalizePaymentStatus(req.body.status, "Completed"),
        paymentDate: asDate(req.body.paymentDate) || new Date(),
        term: req.body.term,
        academicYear: req.body.academicYear,
        notes: req.body.notes,
        actorId: actorUserId(req),
      });
      req.flash?.("success", "Payment recorded successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not record payment.");
    }
    return res.redirect("/admin/payments");
  },

  update: async (req, res) => {
    const { Payment, Invoice, Student } = req.models;
    try {
      if (!isValidId(req.params.id)) throw new Error("Invalid payment ID.");
      const payment = await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!payment) throw new Error("Payment not found.");
      if (payment.status !== "Pending") throw new Error("Completed, voided and refunded payments are immutable. Use Void or Refund instead.");

      const studentId = str(req.body.studentId, 80);
      if (!(await studentExists(Student, studentId))) throw new Error("Select a valid student.");
      const amount = Math.max(0, safeAmount(req.body.amount, 0));
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero.");
      let invoice = null;
      if (isValidId(req.body.invoiceId)) {
        invoice = await Invoice.findOne({ _id: req.body.invoiceId, isDeleted: { $ne: true } });
        if (!invoice) throw new Error("Selected invoice was not found.");
        if (String(invoice.studentId) !== studentId) throw new Error("Payment student must match the invoice student.");
        if (["Draft", "Cancelled"].includes(invoice.status)) throw new Error(`Payments cannot be applied to a ${invoice.status.toLowerCase()} invoice.`);
      }

      payment.studentId = studentId;
      payment.invoiceId = invoice?._id || null;
      const requestedProgramId = isValidId(req.body.programId) ? req.body.programId : invoice?.programId || null;
      payment.programId = requestedProgramId ? await assertProgramAssignment(req.models.Program, requestedProgramId, payment.programId) : null;
      payment.reference = str(req.body.reference, 160);
      payment.amount = amount;
      payment.method = normalizePaymentMethod(req.body.method);
      payment.paymentDate = asDate(req.body.paymentDate) || payment.paymentDate || new Date();
      payment.term = str(req.body.term, 80);
      payment.academicYear = str(req.body.academicYear, 80);
      payment.notes = str(req.body.notes, 2000);
      payment.updatedBy = actorUserId(req);
      await payment.save();

      const requested = normalizePaymentStatus(req.body.status, "Pending");
      if (requested === "Completed") await completePendingPayment(req.models, payment, actorUserId(req));
      else if (requested !== "Pending") throw new Error("Use Void or Refund lifecycle actions instead of editing the payment status.");
      req.flash?.("success", "Payment updated successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not update payment.");
    }
    return res.redirect("/admin/payments");
  },

  complete: async (req, res) => {
    const { Payment } = req.models;
    try {
      const payment = isValidId(req.params.id) ? await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } }) : null;
      if (!payment) throw new Error("Payment not found.");
      if (payment.status !== "Pending") throw new Error("Only Pending payments can be completed.");
      await completePendingPayment(req.models, payment, actorUserId(req));
      req.flash?.("success", "Payment completed and invoice balance recalculated.");
    } catch (err) { req.flash?.("error", err?.message || "Could not complete payment."); }
    return res.redirect("/admin/payments");
  },

  void: async (req, res) => {
    const { Payment } = req.models;
    try {
      const payment = isValidId(req.params.id) ? await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } }) : null;
      if (!payment) throw new Error("Payment not found.");
      await transitionPayment(req.models, payment, "Voided", actorUserId(req), req.body.reason || req.body.notes || "");
      req.flash?.("success", "Payment voided and invoice balance recalculated.");
    } catch (err) { req.flash?.("error", err?.message || "Could not void payment."); }
    return res.redirect("/admin/payments");
  },

  refund: async (req, res) => {
    const { Payment } = req.models;
    try {
      const payment = isValidId(req.params.id) ? await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } }) : null;
      if (!payment) throw new Error("Payment not found.");
      await transitionPayment(req.models, payment, "Refunded", actorUserId(req), req.body.reason || req.body.notes || "");
      req.flash?.("success", "Payment marked refunded and invoice balance recalculated.");
    } catch (err) { req.flash?.("error", err?.message || "Could not refund payment."); }
    return res.redirect("/admin/payments");
  },

  delete: async (req, res) => {
    const { Payment } = req.models;
    try {
      const payment = isValidId(req.params.id) ? await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } }) : null;
      if (!payment) throw new Error("Payment not found.");
      if (payment.status !== "Pending") throw new Error("Only Pending payments can be archived. Completed payments must be voided or refunded.");
      payment.isDeleted = true;
      payment.deletedAt = new Date();
      payment.updatedBy = actorUserId(req);
      await payment.save();
      req.flash?.("success", "Pending payment archived.");
    } catch (err) { req.flash?.("error", err?.message || "Could not archive payment."); }
    return res.redirect("/admin/payments");
  },

  bulkAction: async (req, res) => {
    const { Payment } = req.models;
    const ids = str(req.body.ids, 5000).split(",").map((x) => x.trim()).filter(isValidId);
    if (!ids.length) { req.flash?.("error", "No payments selected."); return res.redirect("/admin/payments"); }
    const action = str(req.body.action, 40);
    const docs = await Payment.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
    let changed = 0; let skipped = 0;
    for (const payment of docs) {
      try {
        if (action === "complete") await transitionPayment(req.models, payment, "Completed", actorUserId(req));
        else if (action === "void") await transitionPayment(req.models, payment, "Voided", actorUserId(req), "Bulk void");
        else if (action === "refund") await transitionPayment(req.models, payment, "Refunded", actorUserId(req), "Bulk refund");
        else if (action === "delete") {
          if (payment.status !== "Pending") throw new Error("not deletable");
          payment.isDeleted = true; payment.deletedAt = new Date(); payment.updatedBy = actorUserId(req); await payment.save();
        } else throw new Error("Unsupported bulk action.");
        changed += 1;
      } catch (_) { skipped += 1; }
    }
    if (changed) req.flash?.("success", `${changed} payment${changed === 1 ? "" : "s"} updated.${skipped ? ` ${skipped} skipped by lifecycle rules.` : ""}`);
    else req.flash?.("error", "No selected payments could be changed under the financial lifecycle rules.");
    return res.redirect("/admin/payments");
  },

  receipt: async (req, res) => {
    const { Payment } = req.models;
    if (!isValidId(req.params.id)) return res.status(404).send("Receipt not found");
    const payment = await Payment.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
      .populate({ path: "invoiceId", populate: { path: "studentId", select: "firstName middleName lastName fullName admissionNumber regNo" } });
    if (!payment) return res.status(404).send("Receipt not found");
    return res.render("tenant/finance/receipts/view", { tenant: req.tenant, payment, invoice: payment.invoiceId || null, receiptStatus: payment.status });
  },

  exportCsv: async (req, res) => {
    const { Payment } = req.models;
    const { mongo } = buildFilters(req.query);
    const rows = await Payment.find(mongo).populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
      .populate("invoiceId", "invoiceNumber").populate("programId", "title shortTitle name code").sort({ paymentDate: -1, createdAt: -1 }).lean();
    const header = ["Receipt No", "Reference", "Student", "Invoice", "Program", "Academic Year", "Term", "Amount", "Method", "Status", "Payment Date"];
    const lines = [header.map(csvCell).join(",")];
    rows.map(serializePayment).forEach((row) => lines.push([
      row.receiptNo, row.reference, row.studentName, row.invoiceNo, row.programName, row.academicYear, row.term,
      row.amount, row.method, row.status, row.paymentDate,
    ].map(csvCell).join(",")));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payments-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },

  _private: { buildFilters, serializePayment, serializeInvoice, computeKpis },
};
