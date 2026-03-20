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

function makeInvoiceNo() {
  return `INV-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
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

function invoiceAmount(inv) {
  return Number(inv.totalAmount || 0);
}

function invoicePaid(inv) {
  return Number(inv.paidAmount || 0);
}

function invoiceBalance(inv) {
  if (inv.balance !== undefined && inv.balance !== null) return Number(inv.balance || 0);
  return Math.max(0, invoiceAmount(inv) - invoicePaid(inv));
}

function normalizeInvoiceStatus(inv) {
  if (inv.status === "Cancelled") return "Cancelled";
  if (inv.status === "Draft") return "Draft";
  const bal = invoiceBalance(inv);
  const paid = invoicePaid(inv);
  if (bal <= 0 && invoiceAmount(inv) > 0) return "Paid";
  if (paid > 0 && bal > 0) return "Partially Paid";
  return inv.status || "Unpaid";
}

function serializeInvoice(doc) {
  const student = doc.studentId || doc.student || null;
  const program = doc.programId || doc.program || null;

  return {
    id: String(doc._id),
    invoiceNo: doc.invoiceNumber || doc.invoiceNo || "—",
    reference: doc.reference || "",
    studentId: student?._id ? String(student._id) : String(doc.studentId?._id || doc.studentId || ""),
    studentName: getStudentName(student),
    programId: program?._id ? String(program._id) : String(doc.programId?._id || doc.programId || ""),
    programName: getProgramName(program),
    term: doc.term || "",
    academicYear: doc.academicYear || "",
    subtotal: Number(doc.subtotal || 0),
    discountAmount: Number(doc.discountAmount || 0),
    taxAmount: Number(doc.taxAmount || 0),
    totalAmount: Number(doc.totalAmount || 0),
    paidAmount: Number(doc.paidAmount || 0),
    balance: invoiceBalance(doc),
    currency: doc.currency || "UGX",
    status: normalizeInvoiceStatus(doc),
    issueDate: doc.issueDate ? new Date(doc.issueDate).toISOString().slice(0, 10) : "",
    dueDate: doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : "",
    notes: doc.notes || "",
    items: Array.isArray(doc.items)
      ? doc.items.map((item, index) => ({
          rowId: String(index + 1),
          title: item.title || "",
          category: item.category || "Tuition",
          qty: Number(item.qty || 1),
          unitAmount: Number(item.unitAmount || 0),
          amount: Number(item.amount || 0),
          note: item.note || "",
        }))
      : [],
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function computeKpis(list = []) {
  const paid = list.filter((x) => x.status === "Paid").length;
  const partial = list.filter((x) => x.status === "Partially Paid").length;
  const unpaid = list.filter((x) => x.status === "Unpaid").length;
  const overdue = list.filter((x) => x.status === "Overdue").length;
  const cancelled = list.filter((x) => x.status === "Cancelled").length;

  const totals = list.reduce(
    (acc, x) => {
      acc.billed += Number(x.totalAmount || 0);
      acc.paid += Number(x.paidAmount || 0);
      acc.balance += Number(x.balance || 0);
      return acc;
    },
    { billed: 0, paid: 0, balance: 0 }
  );

  return {
    total: list.length,
    paid,
    partial,
    unpaid,
    overdue,
    cancelled,
    billed: totals.billed,
    paidValue: totals.paid,
    balanceValue: totals.balance,
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const program = str(query.program || "all");
  const student = str(query.student || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") mongo.status = status;

  if (program !== "all" && isValidId(program)) mongo.programId = program;
  if (student !== "all" && isValidId(student)) mongo.studentId = student;

  if (q) {
    mongo.$or = [
      { invoiceNumber: new RegExp(q, "i") },
      { reference: new RegExp(q, "i") },
      { term: new RegExp(q, "i") },
      { academicYear: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
      { notes: new RegExp(q, "i") },
    ];
  }

  return {
    mongo,
    clean: { q, status, program, student, view },
  };
}

function parseItemsFromBody(body = {}) {
  const titles = Array.isArray(body.itemTitle) ? body.itemTitle : [body.itemTitle];
  const categories = Array.isArray(body.itemCategory) ? body.itemCategory : [body.itemCategory];
  const qtys = Array.isArray(body.itemQty) ? body.itemQty : [body.itemQty];
  const unitAmounts = Array.isArray(body.itemUnitAmount) ? body.itemUnitAmount : [body.itemUnitAmount];
  const notes = Array.isArray(body.itemNote) ? body.itemNote : [body.itemNote];

  const maxLen = Math.max(
    titles.length,
    categories.length,
    qtys.length,
    unitAmounts.length,
    notes.length
  );

  const items = [];

  for (let i = 0; i < maxLen; i += 1) {
    const title = str(titles[i]);
    const category = str(categories[i] || "Tuition");
    const qty = Math.max(1, asNum(qtys[i], 1));
    const unitAmount = Math.max(0, asNum(unitAmounts[i], 0));
    const note = str(notes[i]);

    if (!title) continue;

    items.push({
      title,
      category,
      qty,
      unitAmount,
      amount: qty * unitAmount,
      note,
    });
  }

  return items;
}

module.exports = {
  /**
   * GET /admin/invoices
   */
  index: async (req, res) => {
    const { Invoice, Student, Program, Payment } = req.models;

    const { mongo, clean } = buildFilters(req.query);

    const [invoiceDocs, studentDocs, programDocs, paymentDocs] = await Promise.all([
      Invoice.find(mongo)
        .populate("studentId", "firstName middleName lastName fullName admissionNumber")
        .populate("programId", "name title code")
        .sort({ createdAt: -1, issueDate: -1 })
        .lean(),
      Student
        ? Student.find({})
            .select("firstName middleName lastName fullName admissionNumber")
            .sort({ createdAt: -1 })
            .lean()
        : [],
      Program
        ? Program.find({})
            .select("name title code")
            .sort({ name: 1, title: 1 })
            .lean()
        : [],
      Payment
        ? Payment.find({ isDeleted: { $ne: true } })
            .populate("studentId", "firstName middleName lastName fullName admissionNumber")
            .sort({ paymentDate: -1, createdAt: -1 })
            .limit(30)
            .lean()
        : [],
    ]);

    const invoices = invoiceDocs.map((doc) => {
      const item = serializeInvoice(doc);

      if (item.status !== "Cancelled" && item.status !== "Draft" && item.dueDate) {
        const today = new Date();
        const due = new Date(item.dueDate);
        if (item.balance > 0 && due < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
          item.status = "Overdue";
        }
      }

      return item;
    });

    const payments = (paymentDocs || []).map((p) => ({
      id: String(p._id),
      receiptNo: p.receiptNumber || "—",
      invoiceId: p.invoiceId ? String(p.invoiceId) : "",
      studentName: getStudentName(p.studentId),
      amount: Number(p.amount || 0),
      method: p.method || "Cash",
      status: p.status || "Completed",
      paymentDate: p.paymentDate ? new Date(p.paymentDate).toISOString().slice(0, 10) : "",
    }));

    const kpis = computeKpis(invoices);

    return res.render("tenant/admin/finance/invoices", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      invoices,
      payments,
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
   * POST /admin/invoices
   */
  create: async (req, res) => {
    const { Invoice } = req.models;

    const studentId = str(req.body.studentId);
    const programId = str(req.body.programId);
    const reference = str(req.body.reference);
    const term = str(req.body.term);
    const academicYear = str(req.body.academicYear);
    const discountAmount = Math.max(0, asNum(req.body.discountAmount, 0));
    const taxAmount = Math.max(0, asNum(req.body.taxAmount, 0));
    const currency = str(req.body.currency || "UGX");
    const issueDate = asDate(req.body.issueDate) || new Date();
    const dueDate = asDate(req.body.dueDate);
    const notes = str(req.body.notes);
    const formStatus = str(req.body.status || "Unpaid");

    if (!isValidId(studentId)) {
      req.flash?.("error", "Student is required.");
      return res.redirect("/admin/invoices");
    }

    const items = parseItemsFromBody(req.body);
    if (!items.length) {
      req.flash?.("error", "Add at least one invoice item.");
      return res.redirect("/admin/invoices");
    }

    const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalAmount = Math.max(0, subtotal - discountAmount + taxAmount);
    const paidAmount = 0;
    const balance = totalAmount;

    await Invoice.create({
      invoiceNumber: makeInvoiceNo(),
      reference,
      studentId,
      programId: isValidId(programId) ? programId : null,
      term,
      academicYear,
      items,
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      paidAmount,
      balance,
      currency,
      status: formStatus === "Draft" ? "Draft" : "Unpaid",
      issueDate,
      dueDate,
      notes,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Invoice created successfully.");
    return res.redirect("/admin/invoices");
  },

  /**
   * POST /admin/invoices/:id/update
   */
  update: async (req, res) => {
    const { Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid invoice ID.");
      return res.redirect("/admin/invoices");
    }

    const existing = await Invoice.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!existing) {
      req.flash?.("error", "Invoice not found.");
      return res.redirect("/admin/invoices");
    }

    const studentId = str(req.body.studentId);
    const programId = str(req.body.programId);
    const reference = str(req.body.reference);
    const term = str(req.body.term);
    const academicYear = str(req.body.academicYear);
    const discountAmount = Math.max(0, asNum(req.body.discountAmount, 0));
    const taxAmount = Math.max(0, asNum(req.body.taxAmount, 0));
    const currency = str(req.body.currency || "UGX");
    const issueDate = asDate(req.body.issueDate) || existing.issueDate || new Date();
    const dueDate = asDate(req.body.dueDate);
    const notes = str(req.body.notes);
    const formStatus = str(req.body.status || existing.status || "Unpaid");

    if (!isValidId(studentId)) {
      req.flash?.("error", "Student is required.");
      return res.redirect("/admin/invoices");
    }

    const items = parseItemsFromBody(req.body);
    if (!items.length) {
      req.flash?.("error", "Add at least one invoice item.");
      return res.redirect("/admin/invoices");
    }

    const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalAmount = Math.max(0, subtotal - discountAmount + taxAmount);
    const currentPaid = Math.max(0, Number(existing.paidAmount || 0));
    const balance = Math.max(0, totalAmount - currentPaid);

    let status = formStatus;
    if (status !== "Cancelled" && status !== "Draft") {
      if (balance <= 0 && totalAmount > 0) status = "Paid";
      else if (currentPaid > 0 && balance > 0) status = "Partially Paid";
      else status = "Unpaid";
    }

    existing.reference = reference;
    existing.studentId = studentId;
    existing.programId = isValidId(programId) ? programId : null;
    existing.term = term;
    existing.academicYear = academicYear;
    existing.items = items;
    existing.subtotal = subtotal;
    existing.discountAmount = discountAmount;
    existing.taxAmount = taxAmount;
    existing.totalAmount = totalAmount;
    existing.balance = balance;
    existing.currency = currency;
    existing.status = status;
    existing.issueDate = issueDate;
    existing.dueDate = dueDate;
    existing.notes = notes;
    existing.updatedBy = actorUserId(req);

    await existing.save();

    req.flash?.("success", "Invoice updated successfully.");
    return res.redirect("/admin/invoices");
  },

  /**
   * POST /admin/invoices/:id/mark-paid
   */
  markPaid: async (req, res) => {
    const { Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid invoice ID.");
      return res.redirect("/admin/invoices");
    }

    const invoice = await Invoice.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!invoice) {
      req.flash?.("error", "Invoice not found.");
      return res.redirect("/admin/invoices");
    }

    invoice.paidAmount = Number(invoice.totalAmount || 0);
    invoice.balance = 0;
    invoice.status = "Paid";
    invoice.updatedBy = actorUserId(req);

    await invoice.save();

    req.flash?.("success", "Invoice marked as paid.");
    return res.redirect("/admin/invoices");
  },

  /**
   * POST /admin/invoices/:id/cancel
   */
  cancel: async (req, res) => {
    const { Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid invoice ID.");
      return res.redirect("/admin/invoices");
    }

    await Invoice.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          status: "Cancelled",
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Invoice cancelled.");
    return res.redirect("/admin/invoices");
  },

  /**
   * POST /admin/invoices/:id/delete
   */
  delete: async (req, res) => {
    const { Invoice } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid invoice ID.");
      return res.redirect("/admin/invoices");
    }

    await Invoice.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Invoice deleted.");
    return res.redirect("/admin/invoices");
  },

  /**
   * POST /admin/invoices/bulk
   */
  bulkAction: async (req, res) => {
    const { Invoice } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No invoices selected.");
      return res.redirect("/admin/invoices");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "markPaid") {
      const docs = await Invoice.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
      await Promise.all(
        docs.map((doc) => {
          doc.paidAmount = Number(doc.totalAmount || 0);
          doc.balance = 0;
          doc.status = "Paid";
          doc.updatedBy = actorUserId(req);
          return doc.save();
        })
      );
      req.flash?.("success", "Selected invoices marked as paid.");
      return res.redirect("/admin/invoices");
    }

    if (action === "cancel") patch.status = "Cancelled";
    if (action === "draft") patch.status = "Draft";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    await Invoice.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/invoices");
  },
};