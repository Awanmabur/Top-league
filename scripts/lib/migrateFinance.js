const {
  invoiceNoCandidate,
  receiptNoCandidate,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  normalizePaymentMethod,
  normalizePaymentStatus,
  safeAmount,
} = require("../../src/services/tenant/financeService");

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

async function allocateCode(Model, field, used, candidateFn, now = new Date()) {
  for (let i = 0; i < 20; i += 1) {
    const candidate = candidateFn(now);
    if (used.has(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Model.exists({ [field]: candidate });
    if (!exists) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not repair legacy ${field}.`);
}

function countCodes(rows, field) {
  const counts = new Map();
  rows.forEach((row) => {
    const value = clean(row[field], 80);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
}

async function repairIdentifiers(Model, rows, field, candidateFn) {
  const counts = countCodes(rows, field);
  const kept = new Set();
  const used = new Set(counts.keys());
  let repaired = 0;
  for (const row of rows) {
    const current = clean(row[field], 80);
    const duplicate = current && (counts.get(current) || 0) > 1;
    const keep = current && (!duplicate || !kept.has(current));
    if (keep) {
      kept.add(current);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const replacement = await allocateCode(Model, field, used, candidateFn, row.createdAt || new Date());
    // Direct update avoids validation against partially normalized legacy rows.
    // eslint-disable-next-line no-await-in-loop
    await Model.updateOne({ _id: row._id }, { $set: { [field]: replacement } });
    row[field] = replacement;
    repaired += 1;
  }
  return repaired;
}

async function migrateFinance(models = {}) {
  const { Invoice, Payment } = models;
  if (!Invoice || !Payment) {
    return {
      invoices: 0, payments: 0, repairedInvoiceNumbers: 0, repairedReceiptNumbers: 0,
      normalizedPayments: 0, allocationsRebuilt: 0, mismatchedPaymentsDetached: 0, invoicesRecalculated: 0,
    };
  }

  const invoices = await Invoice.find({}).sort({ createdAt: 1, _id: 1 }).lean();
  const payments = await Payment.find({}).sort({ paymentDate: 1, createdAt: 1, _id: 1 }).lean();
  const repairedInvoiceNumbers = await repairIdentifiers(Invoice, invoices, "invoiceNumber", invoiceNoCandidate);
  const repairedReceiptNumbers = await repairIdentifiers(Payment, payments, "receiptNumber", receiptNoCandidate);

  const invoiceById = new Map(invoices.map((row) => [String(row._id), row]));
  let normalizedPayments = 0;
  let allocationsRebuilt = 0;
  let mismatchedPaymentsDetached = 0;

  // Normalize non-allocation payment fields and detach impossible invoice/student links first.
  for (const row of payments) {
    const patch = {};
    const status = normalizePaymentStatus(row.status, "Completed");
    const method = normalizePaymentMethod(row.method);
    if (status !== row.status) patch.status = status;
    if (method !== row.method) patch.method = method;
    const amount = Math.max(0.01, safeAmount(row.amount, 0.01));
    if (amount !== row.amount) patch.amount = amount;
    if (status === "Completed" && !row.completedAt) patch.completedAt = row.paymentDate || row.createdAt || new Date();
    if (typeof row.isDeleted !== "boolean") patch.isDeleted = false;

    const invoice = row.invoiceId ? invoiceById.get(String(row.invoiceId)) : null;
    if (invoice && String(invoice.studentId || "") !== String(row.studentId || "")) {
      patch.invoiceId = null;
      patch.appliedAmount = 0;
      row.invoiceId = null;
      mismatchedPaymentsDetached += 1;
    }

    if (Object.keys(patch).length) {
      // eslint-disable-next-line no-await-in-loop
      await Payment.updateOne({ _id: row._id }, { $set: patch });
      Object.assign(row, patch);
      normalizedPayments += 1;
    }
  }

  // Rebuild invoice allocations chronologically. This preserves the full payment amount
  // while capping only the portion applied to a specific invoice.
  const remainingByInvoice = new Map();
  for (const invoice of invoices) {
    const totals = computeInvoiceTotals(invoice.items || [], invoice.discountAmount, invoice.taxAmount);
    remainingByInvoice.set(String(invoice._id), totals.totalAmount);
  }

  for (const row of payments) {
    let appliedAmount = 0;
    const invoiceId = row.invoiceId ? String(row.invoiceId) : "";
    if (row.status === "Completed" && invoiceId && remainingByInvoice.has(invoiceId) && row.isDeleted !== true) {
      const remaining = Math.max(0, remainingByInvoice.get(invoiceId) || 0);
      appliedAmount = Math.min(Math.max(0, safeAmount(row.amount, 0)), remaining);
      remainingByInvoice.set(invoiceId, Math.max(0, remaining - appliedAmount));
    }
    if (safeAmount(row.appliedAmount, -1) !== appliedAmount) {
      // eslint-disable-next-line no-await-in-loop
      await Payment.updateOne({ _id: row._id }, { $set: { appliedAmount } });
      row.appliedAmount = appliedAmount;
      allocationsRebuilt += 1;
    }
  }

  let invoicesRecalculated = 0;
  for (const invoice of invoices) {
    const totals = computeInvoiceTotals(invoice.items || [], invoice.discountAmount, invoice.taxAmount);
    const linked = payments.filter((p) => String(p.invoiceId || "") === String(invoice._id) && p.status === "Completed" && p.isDeleted !== true);
    const paidAmount = linked.reduce((sum, p) => sum + Math.max(0, safeAmount(p.appliedAmount, 0)), 0);
    const balance = Math.max(0, totals.totalAmount - paidAmount);
    const hadAppliedPayments = paidAmount > 0;
    let baseStatus = invoice.status;
    if (hadAppliedPayments && ["Draft", "Cancelled"].includes(baseStatus)) baseStatus = "Unpaid";
    const status = deriveInvoiceStatus({ totalAmount: totals.totalAmount, paidAmount, dueDate: invoice.dueDate, status: baseStatus });
    const patch = {
      items: totals.items,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      paidAmount,
      balance,
      status,
      currency: /^[A-Z]{3}$/.test(clean(invoice.currency, 8).toUpperCase()) ? clean(invoice.currency, 8).toUpperCase() : "UGX",
      paymentLeaseToken: "",
      paymentLeaseExpiresAt: null,
      paymentLeaseBy: null,
      isDeleted: invoice.isDeleted === true,
    };
    if (status !== "Cancelled") {
      patch.cancelledAt = null;
      patch.cancelledBy = null;
      patch.cancelReason = "";
    }
    // eslint-disable-next-line no-await-in-loop
    await Invoice.updateOne({ _id: invoice._id }, { $set: patch });
    invoicesRecalculated += 1;
  }

  return {
    invoices: invoices.length,
    payments: payments.length,
    repairedInvoiceNumbers,
    repairedReceiptNumbers,
    normalizedPayments,
    allocationsRebuilt,
    mismatchedPaymentsDetached,
    invoicesRecalculated,
  };
}

module.exports = { migrateFinance, repairIdentifiers };
