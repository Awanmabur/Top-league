const crypto = require("crypto");
const mongoose = require("mongoose");
const { assertActiveProgram } = require("./organizationCatalogService");

const PAYMENT_METHODS = ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Transfer", "Other"];
const PAYMENT_STATUSES = ["Pending", "Completed", "Voided", "Refunded"];
const INVOICE_STATUSES = ["Draft", "Unpaid", "Partially Paid", "Paid", "Overdue", "Cancelled"];
const ACTIVE_PAYMENT_STATUSES = ["Completed"];
const TERMINAL_PAYMENT_STATUSES = ["Voided", "Refunded"];

const str = (v, max = 1000) => String(v ?? "").trim().slice(0, max);
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function dayKey(date = new Date()) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function invoiceNoCandidate(now = new Date()) {
  return `INV-${dayKey(now)}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function receiptNoCandidate(now = new Date()) {
  return `RCPT-${dayKey(now)}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

async function allocateUniqueCode(Model, field, candidateFn, maxAttempts = 12) {
  if (!Model || typeof Model.exists !== "function") throw new Error("Finance identifier model is unavailable.");
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = candidateFn();
    // eslint-disable-next-line no-await-in-loop
    const exists = await Model.exists({ [field]: candidate });
    if (!exists) return candidate;
  }
  throw new Error(`Could not allocate a unique ${field}.`);
}

const allocateInvoiceNumber = (Invoice) => allocateUniqueCode(Invoice, "invoiceNumber", invoiceNoCandidate);
const allocateReceiptNumber = (Payment) => allocateUniqueCode(Payment, "receiptNumber", receiptNoCandidate);

function isDuplicateKeyFor(error, field) {
  if (!error || Number(error.code) !== 11000) return false;
  if (error.keyPattern && error.keyPattern[field]) return true;
  if (error.keyValue && Object.prototype.hasOwnProperty.call(error.keyValue, field)) return true;
  return String(error.message || "").includes(field);
}

async function createWithUniqueCode(Model, field, candidateFn, payload = {}, maxAttempts = 12) {
  if (!Model || typeof Model.create !== "function") throw new Error("Finance record model is unavailable.");
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = candidateFn();
    try {
      // The unique database index is authoritative. Retrying the actual insert
      // closes the race that a separate exists() check can never eliminate.
      // eslint-disable-next-line no-await-in-loop
      return await Model.create({ ...payload, [field]: candidate });
    } catch (error) {
      if (!isDuplicateKeyFor(error, field)) throw error;
    }
  }
  throw new Error(`Could not create a record with a unique ${field}.`);
}

const createInvoiceRecord = (Invoice, payload) => createWithUniqueCode(Invoice, "invoiceNumber", invoiceNoCandidate, payload);
const createPaymentRecord = (Payment, payload) => createWithUniqueCode(Payment, "receiptNumber", receiptNoCandidate, payload);

function safeAmount(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCurrency(value) {
  const v = str(value || "UGX", 8).toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : "UGX";
}

function normalizePaymentMethod(value) {
  const v = str(value, 40);
  return PAYMENT_METHODS.includes(v) ? v : "Other";
}

function normalizePaymentStatus(value, fallback = "Pending") {
  const v = str(value, 40);
  return PAYMENT_STATUSES.includes(v) ? v : fallback;
}

function normalizeInvoiceItems(input = []) {
  const list = Array.isArray(input) ? input : [];
  return list.slice(0, 100).map((item) => {
    const title = str(item?.title, 160);
    if (!title) return null;
    const qty = Math.min(100000, Math.max(1, Math.floor(safeAmount(item?.qty, 1))));
    const unitAmount = Math.min(1e15, Math.max(0, safeAmount(item?.unitAmount, 0)));
    const allowedCategories = ["Tuition", "Registration", "Library", "Hostel", "Examination", "Transport", "Other"];
    const category = allowedCategories.includes(str(item?.category, 40)) ? str(item.category, 40) : "Other";
    return {
      title,
      category,
      qty,
      unitAmount,
      amount: qty * unitAmount,
      note: str(item?.note, 500),
    };
  }).filter(Boolean);
}

function computeInvoiceTotals(items = [], discountAmount = 0, taxAmount = 0) {
  const normalized = normalizeInvoiceItems(items);
  const subtotal = normalized.reduce((sum, item) => sum + safeAmount(item.amount), 0);
  const discount = Math.min(subtotal, Math.max(0, safeAmount(discountAmount, 0)));
  const tax = Math.max(0, safeAmount(taxAmount, 0));
  const totalAmount = Math.max(0, subtotal - discount + tax);
  return { items: normalized, subtotal, discountAmount: discount, taxAmount: tax, totalAmount };
}

function isPastDue(dueDate, now = new Date()) {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function deriveInvoiceStatus({ totalAmount = 0, paidAmount = 0, dueDate = null, status = "Unpaid" } = {}, now = new Date()) {
  if (status === "Cancelled") return "Cancelled";
  if (status === "Draft") return "Draft";
  const total = Math.max(0, safeAmount(totalAmount, 0));
  const paid = Math.max(0, safeAmount(paidAmount, 0));
  const balance = Math.max(0, total - paid);
  if (total > 0 && balance <= 0) return "Paid";
  if (balance > 0 && isPastDue(dueDate, now)) return "Overdue";
  if (paid > 0 && balance > 0) return "Partially Paid";
  return "Unpaid";
}

function paymentCountsTowardsInvoice(status) {
  return ACTIVE_PAYMENT_STATUSES.includes(normalizePaymentStatus(status, "Pending"));
}

function canTransitionPayment(fromStatus, toStatus) {
  const from = normalizePaymentStatus(fromStatus, "Pending");
  const to = normalizePaymentStatus(toStatus, from);
  if (from === to) return true;
  if (TERMINAL_PAYMENT_STATUSES.includes(from)) return false;
  if (from === "Pending") return ["Completed", "Voided"].includes(to);
  if (from === "Completed") return ["Voided", "Refunded"].includes(to);
  return false;
}

function paymentLeaseToken() {
  return crypto.randomBytes(18).toString("hex");
}

async function claimInvoicePaymentLease(Invoice, invoiceId, actorId = null, now = new Date(), ttlMs = 45000) {
  if (!Invoice || !isValidId(invoiceId)) throw new Error("Invoice is unavailable.");
  const token = paymentLeaseToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const invoice = await Invoice.findOneAndUpdate(
    {
      _id: invoiceId,
      isDeleted: { $ne: true },
      $or: [
        { paymentLeaseToken: { $in: [null, ""] } },
        { paymentLeaseToken: { $exists: false } },
        { paymentLeaseExpiresAt: { $lte: now } },
        { paymentLeaseExpiresAt: null },
      ],
    },
    {
      $set: {
        paymentLeaseToken: token,
        paymentLeaseExpiresAt: expiresAt,
        paymentLeaseBy: actorId || null,
      },
    },
    { new: true }
  );
  if (!invoice) throw new Error("Invoice is busy with another payment operation. Try again.");
  return { invoice, token, expiresAt };
}

async function releaseInvoicePaymentLease(Invoice, invoiceId, token) {
  if (!Invoice || !isValidId(invoiceId) || !token) return;
  await Invoice.updateOne(
    { _id: invoiceId, paymentLeaseToken: token },
    { $set: { paymentLeaseToken: "", paymentLeaseExpiresAt: null, paymentLeaseBy: null } }
  ).catch(() => null);
}

async function completedPaymentTotal(Payment, invoiceId, excludePaymentId = null) {
  if (!Payment || !isValidId(invoiceId)) return 0;
  const filter = {
    invoiceId,
    isDeleted: { $ne: true },
    status: "Completed",
  };
  if (excludePaymentId && isValidId(excludePaymentId)) filter._id = { $ne: excludePaymentId };
  const rows = await Payment.find(filter).select("amount appliedAmount").lean();
  return rows.reduce((sum, row) => {
    const applied = row.appliedAmount === undefined || row.appliedAmount === null
      ? safeAmount(row.amount, 0)
      : safeAmount(row.appliedAmount, 0);
    return sum + Math.max(0, applied);
  }, 0);
}

async function recalculateInvoice(models, invoiceId, actorId = null, options = {}) {
  const { Invoice, Payment } = models || {};
  if (!Invoice || !Payment || !isValidId(invoiceId)) return null;
  const invoice = options.invoice || await Invoice.findOne({ _id: invoiceId, isDeleted: { $ne: true } });
  if (!invoice) return null;
  const paidAmount = await completedPaymentTotal(Payment, invoice._id);
  const totalAmount = Math.max(0, safeAmount(invoice.totalAmount, 0));
  const balance = Math.max(0, totalAmount - paidAmount);
  invoice.paidAmount = paidAmount;
  invoice.balance = balance;
  invoice.status = deriveInvoiceStatus({
    totalAmount,
    paidAmount,
    dueDate: invoice.dueDate,
    status: invoice.status,
  });
  invoice.updatedBy = actorId || invoice.updatedBy || null;
  await invoice.save();
  return invoice;
}

function assertInvoiceAcceptsPayment(invoice, studentId, amount) {
  if (!invoice) throw new Error("Selected invoice was not found.");
  if (invoice.isDeleted) throw new Error("Selected invoice is unavailable.");
  if (["Draft", "Cancelled"].includes(invoice.status)) throw new Error(`Payments cannot be applied to a ${invoice.status.toLowerCase()} invoice.`);
  if (String(invoice.studentId?._id || invoice.studentId || "") !== String(studentId || "")) {
    throw new Error("Payment student must match the invoice student.");
  }
  const value = safeAmount(amount, 0);
  if (!(value > 0)) throw new Error("Payment amount must be greater than zero.");
  if (value - safeAmount(invoice.balance, 0) > 0.000001) throw new Error("Payment amount exceeds the invoice balance.");
}

async function createPayment(models, input = {}) {
  const { Payment, Invoice } = models || {};
  if (!Payment) throw new Error("Payment model is unavailable.");

  const studentId = str(input.studentId, 80);
  if (!isValidId(studentId)) throw new Error("Student is required.");
  const amount = Math.max(0, safeAmount(input.amount, 0));
  if (!(amount > 0)) throw new Error("Payment amount must be greater than zero.");

  const status = normalizePaymentStatus(input.status, "Pending");
  if (!["Pending", "Completed"].includes(status)) throw new Error("New payments can only be Pending or Completed.");
  const invoiceId = isValidId(input.invoiceId) ? String(input.invoiceId) : null;
  let lease = null;

  try {
    let invoice = null;
    if (invoiceId) {
      if (!Invoice) throw new Error("Invoice model is unavailable.");
      // Claim even for Pending payments so invoice ownership/status cannot change
      // between validation and persistence. Completed payments additionally
      // recalculate the authoritative balance under the same lease.
      lease = await claimInvoicePaymentLease(Invoice, invoiceId, input.actorId || null);
      invoice = status === "Completed"
        ? await recalculateInvoice(models, invoiceId, input.actorId || null, { invoice: lease.invoice })
        : lease.invoice;
      if (!invoice) throw new Error("Selected invoice was not found.");
      if (String(invoice.studentId?._id || invoice.studentId || "") !== studentId) {
        throw new Error("Payment student must match the invoice student.");
      }
      if (status === "Completed") assertInvoiceAcceptsPayment(invoice, studentId, amount);
      if (["Draft", "Cancelled"].includes(invoice.status)) throw new Error(`Payments cannot be applied to a ${invoice.status.toLowerCase()} invoice.`);
    }

    const requestedProgramId = isValidId(input.programId) ? input.programId : invoice?.programId || null;
    const programId = requestedProgramId ? await assertActiveProgram(models.Program, requestedProgramId) : null;
    const now = new Date();
    const payment = await createPaymentRecord(Payment, {
      reference: str(input.reference, 160),
      studentId,
      invoiceId: invoice?._id || null,
      programId,
      amount,
      appliedAmount: invoice && status === "Completed" ? amount : 0,
      method: normalizePaymentMethod(input.method),
      status,
      paymentDate: input.paymentDate || now,
      term: str(input.term, 80),
      academicYear: str(input.academicYear, 80),
      notes: str(input.notes, 1000),
      completedAt: status === "Completed" ? now : null,
      createdBy: input.actorId || null,
      updatedBy: input.actorId || null,
    });

    if (invoice && status === "Completed") await recalculateInvoice(models, invoice._id, input.actorId || null);
    return payment;
  } finally {
    if (lease && Invoice) await releaseInvoicePaymentLease(Invoice, invoiceId, lease.token);
  }
}

async function completePendingPayment(models, payment, actorId = null) {
  const { Invoice } = models || {};
  if (!payment || payment.status !== "Pending") throw new Error("Only Pending payments can be completed.");
  if (!payment.invoiceId) {
    payment.status = "Completed";
    payment.appliedAmount = 0;
    payment.completedAt = new Date();
    payment.updatedBy = actorId || null;
    await payment.save();
    return payment;
  }

  const invoiceId = String(payment.invoiceId);
  const lease = await claimInvoicePaymentLease(Invoice, invoiceId, actorId);
  try {
    const invoice = await recalculateInvoice(models, invoiceId, actorId, { invoice: lease.invoice });
    assertInvoiceAcceptsPayment(invoice, payment.studentId, payment.amount);
    payment.status = "Completed";
    payment.appliedAmount = Math.max(0, safeAmount(payment.amount, 0));
    payment.completedAt = new Date();
    payment.updatedBy = actorId || null;
    await payment.save();
    await recalculateInvoice(models, invoiceId, actorId);
    return payment;
  } finally {
    await releaseInvoicePaymentLease(Invoice, invoiceId, lease.token);
  }
}

async function transitionPayment(models, payment, targetStatus, actorId = null, reason = "") {
  const { Invoice } = models || {};
  const target = normalizePaymentStatus(targetStatus, payment?.status || "Pending");
  if (!payment) throw new Error("Payment not found.");
  if (!canTransitionPayment(payment.status, target)) throw new Error(`Payment cannot move from ${payment.status} to ${target}.`);
  if (payment.status === target) return payment;
  if (target === "Completed") return completePendingPayment(models, payment, actorId);

  const invoiceId = payment.invoiceId ? String(payment.invoiceId) : null;
  let lease = null;
  try {
    if (invoiceId && Invoice) lease = await claimInvoicePaymentLease(Invoice, invoiceId, actorId);
    const now = new Date();
    payment.status = target;
    payment.updatedBy = actorId || null;
    if (target === "Voided") {
      payment.voidedAt = now;
      payment.voidedBy = actorId || null;
      payment.voidReason = str(reason, 500);
    }
    if (target === "Refunded") {
      payment.refundedAt = now;
      payment.refundedBy = actorId || null;
      payment.refundReason = str(reason, 500);
    }
    await payment.save();
    if (invoiceId) await recalculateInvoice(models, invoiceId, actorId);
    return payment;
  } finally {
    if (lease && Invoice) await releaseInvoicePaymentLease(Invoice, invoiceId, lease.token);
  }
}

async function settleInvoice(models, invoiceId, input = {}) {
  const { Invoice } = models || {};
  if (!Invoice || !isValidId(invoiceId)) throw new Error("Invoice not found.");
  const lease = await claimInvoicePaymentLease(Invoice, invoiceId, input.actorId || null);
  try {
    const invoice = await recalculateInvoice(models, invoiceId, input.actorId || null, { invoice: lease.invoice });
    if (!invoice) throw new Error("Invoice not found.");
    if (["Draft", "Cancelled"].includes(invoice.status)) throw new Error(`A ${invoice.status.toLowerCase()} invoice cannot be settled.`);
    const balance = Math.max(0, safeAmount(invoice.balance, 0));
    if (!(balance > 0)) throw new Error("Invoice has no outstanding balance.");

    const Payment = models.Payment;
    const now = new Date();
    const payment = await createPaymentRecord(Payment, {
      reference: str(input.reference || `Settlement for ${invoice.invoiceNumber}`, 160),
      studentId: invoice.studentId,
      invoiceId: invoice._id,
      programId: invoice.programId || null,
      amount: balance,
      appliedAmount: balance,
      method: normalizePaymentMethod(input.method || "Other"),
      status: "Completed",
      paymentDate: input.paymentDate || now,
      term: invoice.term || "",
      academicYear: invoice.academicYear || "",
      notes: str(input.notes || "Manual invoice settlement", 1000),
      completedAt: now,
      createdBy: input.actorId || null,
      updatedBy: input.actorId || null,
    });
    await recalculateInvoice(models, invoice._id, input.actorId || null);
    return payment;
  } finally {
    await releaseInvoicePaymentLease(Invoice, invoiceId, lease.token);
  }
}

async function cancelInvoice(models, invoiceId, actorId = null, reason = "") {
  const { Invoice } = models || {};
  const lease = await claimInvoicePaymentLease(Invoice, invoiceId, actorId);
  try {
    const invoice = await recalculateInvoice(models, invoiceId, actorId, { invoice: lease.invoice });
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.status === "Cancelled") return invoice;
    if (safeAmount(invoice.paidAmount, 0) > 0) throw new Error("An invoice with completed payments cannot be cancelled. Void or refund the payments first.");
    invoice.status = "Cancelled";
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = actorId || null;
    invoice.cancelReason = str(reason, 500);
    invoice.updatedBy = actorId || null;
    await invoice.save();
    return invoice;
  } finally {
    await releaseInvoicePaymentLease(Invoice, invoiceId, lease.token);
  }
}

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  INVOICE_STATUSES,
  ACTIVE_PAYMENT_STATUSES,
  TERMINAL_PAYMENT_STATUSES,
  str,
  isValidId,
  escapeRegex,
  csvCell,
  safeAmount,
  normalizeCurrency,
  normalizePaymentMethod,
  normalizePaymentStatus,
  normalizeInvoiceItems,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  paymentCountsTowardsInvoice,
  canTransitionPayment,
  invoiceNoCandidate,
  receiptNoCandidate,
  allocateInvoiceNumber,
  allocateReceiptNumber,
  createWithUniqueCode,
  createInvoiceRecord,
  createPaymentRecord,
  claimInvoicePaymentLease,
  releaseInvoicePaymentLease,
  completedPaymentTotal,
  recalculateInvoice,
  assertInvoiceAcceptsPayment,
  createPayment,
  completePendingPayment,
  transitionPayment,
  settleInvoice,
  cancelInvoice,
};
