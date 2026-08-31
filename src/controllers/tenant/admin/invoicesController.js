const mongoose = require("mongoose");
const {
  str,
  isValidId,
  escapeRegex,
  csvCell,
  safeAmount,
  normalizeCurrency,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  allocateInvoiceNumber,
  createInvoiceRecord,
  completedPaymentTotal,
  recalculateInvoice,
  claimInvoicePaymentLease,
  releaseInvoicePaymentLease,
  settleInvoice,
  cancelInvoice,
} = require("../../../services/tenant/financeService");
const { assertActiveProgram, assertProgramAssignment } = require("../../../services/tenant/organizationCatalogService");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

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

function serializeInvoice(doc) {
  const student = doc.studentId || null;
  const program = doc.programId || null;
  const totalAmount = Number(doc.totalAmount || 0);
  const paidAmount = Number(doc.paidAmount || 0);
  const balance = Math.max(0, Number(doc.balance ?? totalAmount - paidAmount));
  return {
    id: String(doc._id),
    invoiceNo: doc.invoiceNumber || "—",
    reference: doc.reference || "",
    studentId: student?._id ? String(student._id) : String(doc.studentId?._id || doc.studentId || ""),
    studentName: getStudentName(student),
    programId: program?._id ? String(program._id) : String(doc.programId?._id || doc.programId || ""),
    programName: getProgramName(program),
    feeStructureId: doc.feeStructureId?._id ? String(doc.feeStructureId._id) : String(doc.feeStructureId || ""),
    term: doc.term || "",
    academicYear: doc.academicYear || "",
    subtotal: Number(doc.subtotal || 0),
    discountAmount: Number(doc.discountAmount || 0),
    taxAmount: Number(doc.taxAmount || 0),
    totalAmount,
    paidAmount,
    balance,
    currency: doc.currency || "UGX",
    status: deriveInvoiceStatus({ totalAmount, paidAmount, dueDate: doc.dueDate, status: doc.status }),
    issueDate: doc.issueDate ? new Date(doc.issueDate).toISOString().slice(0, 10) : "",
    dueDate: doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : "",
    notes: doc.notes || "",
    items: Array.isArray(doc.items)
      ? doc.items.map((item, index) => ({
          rowId: String(index + 1),
          title: item.title || "",
          category: item.category || "Other",
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
  const totals = list.reduce((acc, x) => {
    acc.billed += Number(x.totalAmount || 0);
    acc.paid += Number(x.paidAmount || 0);
    acc.balance += Number(x.balance || 0);
    return acc;
  }, { billed: 0, paid: 0, balance: 0 });
  return {
    total: list.length,
    paid: list.filter((x) => x.status === "Paid").length,
    partial: list.filter((x) => x.status === "Partially Paid").length,
    unpaid: list.filter((x) => x.status === "Unpaid").length,
    overdue: list.filter((x) => x.status === "Overdue").length,
    cancelled: list.filter((x) => x.status === "Cancelled").length,
    billed: totals.billed,
    paidValue: totals.paid,
    balanceValue: totals.balance,
  };
}

function buildFilters(query = {}) {
  const q = str(query.q, 120);
  const status = str(query.status || "all", 40);
  const program = str(query.program || "all", 80);
  const student = str(query.student || "all", 80);
  const view = str(query.view || "list", 20) || "list";
  const mongo = { isDeleted: { $ne: true } };

  if (status !== "all") {
    if (status === "Overdue") {
      mongo.status = { $nin: ["Draft", "Paid", "Cancelled"] };
      mongo.balance = { $gt: 0 };
      mongo.dueDate = { $lt: new Date(new Date().setHours(0, 0, 0, 0)) };
    } else {
      mongo.status = status;
    }
  }
  if (program !== "all" && isValidId(program)) mongo.programId = program;
  if (student !== "all" && isValidId(student)) mongo.studentId = student;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { invoiceNumber: rx },
      { reference: rx },
      { term: rx },
      { academicYear: rx },
      { status: rx },
      { notes: rx },
    ];
  }
  return { mongo, clean: { q, status, program, student, view } };
}

function parseItemsFromBody(body = {}) {
  const arr = (value) => Array.isArray(value) ? value : [value];
  const titles = arr(body.itemTitle);
  const categories = arr(body.itemCategory);
  const qtys = arr(body.itemQty);
  const units = arr(body.itemUnitAmount);
  const notes = arr(body.itemNote);
  const max = Math.min(100, Math.max(titles.length, categories.length, qtys.length, units.length, notes.length));
  const items = [];
  for (let i = 0; i < max; i += 1) {
    if (!str(titles[i], 160)) continue;
    items.push({ title: titles[i], category: categories[i], qty: qtys[i], unitAmount: units[i], note: notes[i] });
  }
  return items;
}

async function studentExists(Student, id) {
  if (!Student || !isValidId(id)) return false;
  return !!(await Student.exists({ _id: id }));
}

async function renderIndex(req, res) {
  const { Invoice, Student, Subject, Program, Payment, FeeStructure } = req.models;
  const AcademicProgram = Program || Subject || null;
  const { mongo, clean } = buildFilters(req.query);
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 50;
  const [totalCount, invoiceDocs, kpiDocs, studentDocs, programDocs, paymentDocs] = await Promise.all([
    Invoice.countDocuments(mongo),
    Invoice.find(mongo).populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
      .populate("programId", "title shortTitle name code").sort({ createdAt: -1, issueDate: -1 })
      .skip((page - 1) * perPage).limit(perPage).lean(),
    Invoice.find(mongo).select("totalAmount paidAmount balance status dueDate").lean(),
    Student ? Student.find({}).select("firstName middleName lastName fullName admissionNumber regNo").sort({ createdAt: -1 }).limit(4000).lean() : [],
    AcademicProgram ? AcademicProgram.find({}).select("title shortTitle name code").sort({ title: 1, shortTitle: 1, name: 1, code: 1 }).lean() : [],
    Payment ? Payment.find({ isDeleted: { $ne: true } }).populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
      .sort({ paymentDate: -1, createdAt: -1 }).limit(30).lean() : [],
  ]);

  const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);
  const safePage = Math.min(page, totalPages);
  const invoices = invoiceDocs.map(serializeInvoice);
  const kpiItems = kpiDocs.map(serializeInvoice);
  const payments = (paymentDocs || []).map((p) => ({
    id: String(p._id), receiptNo: p.receiptNumber || "—", invoiceId: p.invoiceId ? String(p.invoiceId) : "",
    studentName: getStudentName(p.studentId), amount: Number(p.amount || 0), method: p.method || "Other",
    status: p.status || "Pending", paymentDate: p.paymentDate ? new Date(p.paymentDate).toISOString().slice(0, 10) : "",
  }));
  let invoiceTemplate = null;
  const structureId = str(req.query.structure, 80);
  if (FeeStructure && isValidId(structureId)) {
    const structure = await FeeStructure.findOne({ _id: structureId, status: "Active", isDeleted: { $ne: true } })
      .populate("programId", "title shortTitle name code").lean();
    if (structure) {
      invoiceTemplate = {
        id: String(structure._id), name: structure.name || "Fee Structure",
        programId: structure.programId?._id ? String(structure.programId._id) : String(structure.programId || ""),
        programName: getProgramName(structure.programId), academicYear: structure.academicYear || "", term: structure.term || "", notes: structure.notes || "",
        items: (structure.items || []).map((item) => ({ title: item.title || "", category: item.category || "Other", qty: 1, unitAmount: Number(item.amount || 0), amount: Number(item.amount || 0), note: item.note || "" })),
      };
    }
  }

  return res.render("tenant/finance/invoices", {
    tenant: req.tenant,
    csrfToken: req.csrfToken?.(),
    invoices,
    payments,
    kpis: computeKpis(kpiItems),
    students: (studentDocs || []).map((s) => ({ id: String(s._id), name: getStudentName(s) })),
    programs: (programDocs || []).map((p) => ({ id: String(p._id), name: getProgramName(p) })),
    query: { ...clean, page: safePage, perPage, total: totalCount, totalPages },
    invoiceTemplate,
  });
}

module.exports = {
  index: renderIndex,

  create: async (req, res) => {
    const { Invoice, Student } = req.models;
    try {
      const studentId = str(req.body.studentId, 80);
      if (!(await studentExists(Student, studentId))) throw new Error("Select a valid student.");
      let feeStructureId = null;
      if (isValidId(req.body.feeStructureId)) {
        const FeeStructure = req.models.FeeStructure;
        const structure = FeeStructure ? await FeeStructure.findOne({ _id: req.body.feeStructureId, status: "Active", isDeleted: { $ne: true } }).select("_id").lean() : null;
        if (!structure) throw new Error("Selected fee structure is not active or no longer available.");
        feeStructureId = structure._id;
      }
      const totals = computeInvoiceTotals(parseItemsFromBody(req.body), req.body.discountAmount, req.body.taxAmount);
      if (!totals.items.length) throw new Error("Add at least one invoice item.");
      if (!(totals.totalAmount > 0)) throw new Error("Invoice total must be greater than zero.");
      const issueDate = asDate(req.body.issueDate) || new Date();
      const dueDate = asDate(req.body.dueDate);
      if (dueDate && dueDate < new Date(issueDate.getFullYear(), issueDate.getMonth(), issueDate.getDate())) throw new Error("Due date cannot be before issue date.");
      const programId = isValidId(req.body.programId)
        ? await assertActiveProgram(req.models.Program, req.body.programId)
        : null;
      await createInvoiceRecord(Invoice, {
        reference: str(req.body.reference, 160),
        studentId,
        programId,
        feeStructureId,
        term: str(req.body.term, 80),
        academicYear: str(req.body.academicYear, 80),
        ...totals,
        paidAmount: 0,
        balance: totals.totalAmount,
        currency: normalizeCurrency(req.body.currency),
        status: str(req.body.status, 40) === "Draft" ? "Draft" : "Unpaid",
        issueDate,
        dueDate,
        notes: str(req.body.notes, 2000),
        createdBy: actorUserId(req),
        updatedBy: actorUserId(req),
      });
      req.flash?.("success", "Invoice created successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not create invoice.");
    }
    return res.redirect("/admin/invoices");
  },

  update: async (req, res) => {
    const { Invoice, Payment, Student } = req.models;
    let lease = null;
    try {
      if (!isValidId(req.params.id)) throw new Error("Invalid invoice ID.");
      lease = await claimInvoicePaymentLease(Invoice, req.params.id, actorUserId(req));
      const invoice = lease.invoice;
      if (!invoice) throw new Error("Invoice not found.");
      if (invoice.status === "Cancelled") throw new Error("Cancelled invoices are immutable.");
      await recalculateInvoice(req.models, invoice._id, actorUserId(req), { invoice });

      const studentId = str(req.body.studentId, 80);
      if (!(await studentExists(Student, studentId))) throw new Error("Select a valid student.");
      const completedTotal = await completedPaymentTotal(Payment, invoice._id);
      if (completedTotal > 0 && String(invoice.studentId) !== studentId) throw new Error("The student cannot be changed after a completed payment exists.");

      const totals = computeInvoiceTotals(parseItemsFromBody(req.body), req.body.discountAmount, req.body.taxAmount);
      if (!totals.items.length) throw new Error("Add at least one invoice item.");
      if (totals.totalAmount + 0.000001 < completedTotal) throw new Error("Invoice total cannot be reduced below completed payments.");

      const issueDate = asDate(req.body.issueDate) || invoice.issueDate || new Date();
      const dueDate = asDate(req.body.dueDate);
      if (dueDate && dueDate < new Date(issueDate.getFullYear(), issueDate.getMonth(), issueDate.getDate())) throw new Error("Due date cannot be before issue date.");

      const programId = isValidId(req.body.programId)
        ? await assertProgramAssignment(req.models.Program, req.body.programId, invoice.programId)
        : null;
      invoice.reference = str(req.body.reference, 160);
      invoice.studentId = studentId;
      invoice.programId = programId;
      invoice.term = str(req.body.term, 80);
      invoice.academicYear = str(req.body.academicYear, 80);
      invoice.items = totals.items;
      invoice.subtotal = totals.subtotal;
      invoice.discountAmount = totals.discountAmount;
      invoice.taxAmount = totals.taxAmount;
      invoice.totalAmount = totals.totalAmount;
      invoice.paidAmount = completedTotal;
      invoice.balance = Math.max(0, totals.totalAmount - completedTotal);
      invoice.currency = normalizeCurrency(req.body.currency);
      if (invoice.status === "Draft" && completedTotal <= 0) invoice.status = str(req.body.status, 40) === "Draft" ? "Draft" : "Unpaid";
      else invoice.status = deriveInvoiceStatus({ totalAmount: totals.totalAmount, paidAmount: completedTotal, dueDate, status: "Unpaid" });
      invoice.issueDate = issueDate;
      invoice.dueDate = dueDate;
      invoice.notes = str(req.body.notes, 2000);
      invoice.updatedBy = actorUserId(req);
      await invoice.save();
      req.flash?.("success", "Invoice updated successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not update invoice.");
    } finally {
      if (lease) await releaseInvoicePaymentLease(Invoice, req.params.id, lease.token);
    }
    return res.redirect("/admin/invoices");
  },

  markPaid: async (req, res) => {
    try {
      await settleInvoice(req.models, req.params.id, {
        actorId: actorUserId(req),
        method: req.body.method || "Other",
        reference: req.body.reference || "",
        notes: req.body.notes || "Manual settlement from invoice action",
      });
      req.flash?.("success", "Invoice settled with a real payment receipt.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not settle invoice.");
    }
    return res.redirect("/admin/invoices");
  },

  cancel: async (req, res) => {
    try {
      await cancelInvoice(req.models, req.params.id, actorUserId(req), req.body.reason || req.body.notes || "");
      req.flash?.("success", "Invoice cancelled.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not cancel invoice.");
    }
    return res.redirect("/admin/invoices");
  },

  delete: async (req, res) => {
    const { Invoice, Payment } = req.models;
    try {
      if (!isValidId(req.params.id)) throw new Error("Invalid invoice ID.");
      const invoice = await Invoice.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!invoice) throw new Error("Invoice not found.");
      if (!["Draft", "Cancelled"].includes(invoice.status)) throw new Error("Only Draft or Cancelled invoices can be deleted.");
      if (Payment && await Payment.exists({ invoiceId: invoice._id, isDeleted: { $ne: true } })) throw new Error("An invoice with payment records cannot be deleted.");
      invoice.isDeleted = true;
      invoice.deletedAt = new Date();
      invoice.updatedBy = actorUserId(req);
      await invoice.save();
      req.flash?.("success", "Invoice archived.");
    } catch (err) {
      req.flash?.("error", err?.message || "Could not archive invoice.");
    }
    return res.redirect("/admin/invoices");
  },

  bulkAction: async (req, res) => {
    const { Invoice } = req.models;
    const ids = str(req.body.ids, 5000).split(",").map((x) => x.trim()).filter(isValidId);
    if (!ids.length) {
      req.flash?.("error", "No invoices selected.");
      return res.redirect("/admin/invoices");
    }
    const action = str(req.body.action, 40);
    let changed = 0;
    let skipped = 0;
    const docs = await Invoice.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
    for (const doc of docs) {
      try {
        if (action === "markPaid") await settleInvoice(req.models, doc._id, { actorId: actorUserId(req), method: "Other", notes: "Bulk manual settlement" });
        else if (action === "cancel") await cancelInvoice(req.models, doc._id, actorUserId(req), "Bulk cancellation");
        else if (action === "delete") {
          if (!["Draft", "Cancelled"].includes(doc.status)) throw new Error("not deletable");
          if (req.models.Payment && await req.models.Payment.exists({ invoiceId: doc._id, isDeleted: { $ne: true } })) throw new Error("has payments");
          doc.isDeleted = true; doc.deletedAt = new Date(); doc.updatedBy = actorUserId(req); await doc.save();
        } else throw new Error("Unsupported bulk action.");
        changed += 1;
      } catch (_) { skipped += 1; }
    }
    if (changed) req.flash?.("success", `${changed} invoice${changed === 1 ? "" : "s"} updated.${skipped ? ` ${skipped} skipped by lifecycle rules.` : ""}`);
    else req.flash?.("error", "No selected invoices could be changed under the financial lifecycle rules.");
    return res.redirect("/admin/invoices");
  },

  exportCsv: async (req, res) => {
    const { Invoice } = req.models;
    const { mongo } = buildFilters(req.query);
    const rows = await Invoice.find(mongo).populate("studentId", "firstName middleName lastName fullName admissionNumber regNo")
      .populate("programId", "title shortTitle name code").sort({ createdAt: -1 }).lean();
    const header = ["Invoice No", "Reference", "Student", "Program", "Academic Year", "Term", "Currency", "Total", "Paid", "Balance", "Status", "Issue Date", "Due Date"];
    const lines = [header.map(csvCell).join(",")];
    rows.map(serializeInvoice).forEach((row) => lines.push([
      row.invoiceNo, row.reference, row.studentName, row.programName, row.academicYear, row.term, row.currency,
      row.totalAmount, row.paidAmount, row.balance, row.status, row.issueDate, row.dueDate,
    ].map(csvCell).join(",")));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },

  _private: { buildFilters, parseItemsFromBody, serializeInvoice, computeKpis },
};
