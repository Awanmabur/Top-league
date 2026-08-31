const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  invoiceNoCandidate,
  receiptNoCandidate,
  createWithUniqueCode,
  computeInvoiceTotals,
  deriveInvoiceStatus,
  normalizePaymentStatus,
  paymentCountsTowardsInvoice,
  canTransitionPayment,
  csvCell,
  claimInvoicePaymentLease,
  createPayment,
  transitionPayment,
} = require('../src/services/tenant/financeService');

const oid = () => new mongoose.Types.ObjectId();

test('finance identifiers use dated cryptographic suffixes', () => {
  const date = new Date('2026-08-29T10:00:00Z');
  assert.match(invoiceNoCandidate(date), /^INV-20260829-[0-9A-F]{10}$/);
  assert.match(receiptNoCandidate(date), /^RCPT-20260829-[0-9A-F]{10}$/);
});

test('database insert retries actual duplicate-key races', async () => {
  let calls = 0;
  const Model = {
    create: async (payload) => {
      calls += 1;
      if (calls < 3) {
        const err = new Error('duplicate invoiceNumber');
        err.code = 11000;
        err.keyPattern = { invoiceNumber: 1 };
        throw err;
      }
      return payload;
    },
  };
  let candidate = 0;
  const doc = await createWithUniqueCode(Model, 'invoiceNumber', () => `INV-X-${++candidate}`, { amount: 10 });
  assert.equal(calls, 3);
  assert.equal(doc.invoiceNumber, 'INV-X-3');
  assert.equal(doc.amount, 10);
});

test('non-duplicate insert errors fail immediately', async () => {
  let calls = 0;
  const Model = { create: async () => { calls += 1; throw new Error('validation failed'); } };
  await assert.rejects(() => createWithUniqueCode(Model, 'invoiceNumber', () => 'INV-X', {}), /validation failed/);
  assert.equal(calls, 1);
});

test('invoice totals normalize items, discount and tax safely', () => {
  const result = computeInvoiceTotals([
    { title: 'Tuition', category: 'Tuition', qty: 2, unitAmount: 100 },
    { title: '', qty: 1, unitAmount: 999 },
  ], 50, 25);
  assert.equal(result.items.length, 1);
  assert.equal(result.subtotal, 200);
  assert.equal(result.discountAmount, 50);
  assert.equal(result.taxAmount, 25);
  assert.equal(result.totalAmount, 175);
});

test('invoice status is derived from authoritative amounts and dates', () => {
  const now = new Date('2026-08-29T12:00:00Z');
  assert.equal(deriveInvoiceStatus({ totalAmount: 100, paidAmount: 0, status: 'Draft' }, now), 'Draft');
  assert.equal(deriveInvoiceStatus({ totalAmount: 100, paidAmount: 0, status: 'Cancelled' }, now), 'Cancelled');
  assert.equal(deriveInvoiceStatus({ totalAmount: 100, paidAmount: 100, status: 'Unpaid' }, now), 'Paid');
  assert.equal(deriveInvoiceStatus({ totalAmount: 100, paidAmount: 40, status: 'Unpaid' }, now), 'Partially Paid');
  assert.equal(deriveInvoiceStatus({ totalAmount: 100, paidAmount: 0, dueDate: '2026-08-28', status: 'Unpaid' }, now), 'Overdue');
});

test('only Completed payments count as money applied', () => {
  assert.equal(paymentCountsTowardsInvoice('Completed'), true);
  for (const status of ['Pending', 'Voided', 'Refunded']) assert.equal(paymentCountsTowardsInvoice(status), false);
});

test('payment lifecycle cannot resurrect terminal records', () => {
  assert.equal(canTransitionPayment('Pending', 'Completed'), true);
  assert.equal(canTransitionPayment('Pending', 'Voided'), true);
  assert.equal(canTransitionPayment('Completed', 'Refunded'), true);
  assert.equal(canTransitionPayment('Completed', 'Voided'), true);
  assert.equal(canTransitionPayment('Refunded', 'Completed'), false);
  assert.equal(canTransitionPayment('Voided', 'Pending'), false);
});

test('invalid payment status falls back safely', () => {
  assert.equal(normalizePaymentStatus('hacked', 'Pending'), 'Pending');
});

test('finance CSV cells neutralize spreadsheet formulas', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('+cmd|x'), '"\'+cmd|x"');
});

test('invoice payment lease fails closed when another operation owns the invoice', async () => {
  const Invoice = { findOneAndUpdate: async () => null };
  await assert.rejects(() => claimInvoicePaymentLease(Invoice, oid().toString(), null), /busy with another payment operation/);
});

test('invoice-linked Pending payment claims lease before persistence', async () => {
  const studentId = oid();
  const invoiceId = oid();
  const invoice = { _id: invoiceId, studentId, status: 'Unpaid', balance: 100, totalAmount: 100, isDeleted: false };
  let claimed = 0;
  let released = 0;
  let created = null;
  const models = {
    Invoice: {
      findOneAndUpdate: async () => { claimed += 1; return invoice; },
      updateOne: async () => { released += 1; },
    },
    Payment: {
      create: async (payload) => { created = payload; return payload; },
    },
  };
  const payment = await createPayment(models, { studentId: studentId.toString(), invoiceId: invoiceId.toString(), amount: 50, status: 'Pending' });
  assert.equal(claimed, 1);
  assert.equal(released, 1);
  assert.equal(payment.status, 'Pending');
  assert.equal(created.appliedAmount, 0);
});

test('new payment rejects terminal statuses even if submitted manually', async () => {
  const models = { Payment: { create: async () => { throw new Error('should not create'); } } };
  await assert.rejects(() => createPayment(models, { studentId: oid().toString(), amount: 10, status: 'Refunded' }), /only be Pending or Completed/);
});

test('voiding a completed payment records audit fields and does not make it Completed again', async () => {
  const payment = {
    _id: oid(), studentId: oid(), invoiceId: null, status: 'Completed', appliedAmount: 0,
    save: async function () { return this; },
  };
  await transitionPayment({}, payment, 'Voided', oid(), 'duplicate');
  assert.equal(payment.status, 'Voided');
  assert.ok(payment.voidedAt instanceof Date);
  assert.equal(payment.voidReason, 'duplicate');
  await assert.rejects(() => transitionPayment({}, payment, 'Completed', oid()), /cannot move/);
});
