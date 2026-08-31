const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../src/services/tenant/financeVisibilityService');

function invoice(overrides = {}) {
  return { totalAmount: 1000, paidAmount: 0, balance: 1000, status: 'Unpaid', isDeleted: false, ...overrides };
}
function payment(overrides = {}) {
  return { amount: 500, appliedAmount: 500, status: 'Completed', isDeleted: false, invoiceId: 'inv1', ...overrides };
}

test('activeInvoice includes live receivables', () => assert.equal(svc.activeInvoice(invoice()), true));
test('activeInvoice excludes Draft invoices', () => assert.equal(svc.activeInvoice(invoice({ status: 'Draft' })), false));
test('activeInvoice excludes Cancelled invoices', () => assert.equal(svc.activeInvoice(invoice({ status: 'Cancelled' })), false));
test('activeInvoice excludes deleted invoices', () => assert.equal(svc.activeInvoice(invoice({ isDeleted: true })), false));
test('completedPayment accepts only Completed live payments', () => assert.equal(svc.completedPayment(payment()), true));
test('completedPayment rejects Pending payments', () => assert.equal(svc.completedPayment(payment({ status: 'Pending' })), false));
test('completedPayment rejects Refunded payments', () => assert.equal(svc.completedPayment(payment({ status: 'Refunded' })), false));
test('completedPayment rejects deleted payments', () => assert.equal(svc.completedPayment(payment({ isDeleted: true })), false));

test('invoiceOutstanding trusts bounded persisted balance', () => assert.equal(svc.invoiceOutstanding(invoice({ balance: 350 })), 350));
test('invoiceOutstanding clamps negative balance to zero', () => assert.equal(svc.invoiceOutstanding(invoice({ balance: -20 })), 0));
test('invoiceOutstanding clamps balance above total', () => assert.equal(svc.invoiceOutstanding(invoice({ totalAmount: 1000, balance: 5000 })), 1000));
test('invoiceOutstanding falls back to total minus paid', () => assert.equal(svc.invoiceOutstanding(invoice({ balance: undefined, paidAmount: 250 })), 750));
test('invoiceOutstanding is zero for cancelled invoices', () => assert.equal(svc.invoiceOutstanding(invoice({ status: 'Cancelled' })), 0));

test('paymentAppliedAmount uses explicit allocation', () => assert.equal(svc.paymentAppliedAmount(payment({ amount: 800, appliedAmount: 300 })), 300));
test('paymentAppliedAmount clamps allocation to payment amount', () => assert.equal(svc.paymentAppliedAmount(payment({ amount: 800, appliedAmount: 1200 })), 800));
test('paymentAppliedAmount treats legacy invoice-bound Completed payment as fully applied', () => assert.equal(svc.paymentAppliedAmount(payment({ amount: 800, appliedAmount: undefined, invoiceId: 'i1' })), 800));
test('paymentAppliedAmount treats legacy unbound Completed payment as account credit', () => assert.equal(svc.paymentAppliedAmount(payment({ amount: 800, appliedAmount: undefined, invoiceId: null })), 0));
test('paymentAppliedAmount ignores non-Completed payment', () => assert.equal(svc.paymentAppliedAmount(payment({ status: 'Pending', amount: 800 })), 0));

test('accountSnapshot excludes Draft and non-Completed money', () => {
  const out = svc.accountSnapshot([invoice(), invoice({ status: 'Draft', totalAmount: 9999 })], [payment(), payment({ status: 'Pending', amount: 9999 })]);
  assert.equal(out.billed, 1000);
  assert.equal(out.paid, 500);
  assert.equal(out.invoiceCount, 1);
  assert.equal(out.paymentCount, 1);
});
test('accountSnapshot separates received from applied money', () => {
  const out = svc.accountSnapshot([invoice({ balance: 700 })], [payment({ amount: 500, appliedAmount: 300 })]);
  assert.equal(out.received, 500);
  assert.equal(out.applied, 300);
  assert.equal(out.unallocatedCredit, 200);
  assert.equal(out.invoiceOutstanding, 700);
  assert.equal(out.balance, 500);
});
test('accountSnapshot exposes excess account credit rather than negative balance', () => {
  const out = svc.accountSnapshot([invoice({ balance: 100 })], [payment({ amount: 500, appliedAmount: 100 })]);
  assert.equal(out.unallocatedCredit, 400);
  assert.equal(out.balance, 0);
  assert.equal(out.credit, 300);
});
test('accountSnapshot does not count refunded cash as received', () => {
  const out = svc.accountSnapshot([invoice()], [payment({ status: 'Refunded', amount: 1000, appliedAmount: 1000 })]);
  assert.equal(out.paid, 0);
  assert.equal(out.balance, 1000);
});
test('separate account snapshots prevent one student credit from cancelling another student debt', () => {
  const debtor = svc.accountSnapshot([invoice({ balance: 700 })], []);
  const creditor = svc.accountSnapshot([], [payment({ amount: 900, appliedAmount: 0, invoiceId: null })]);
  assert.equal(debtor.balance, 700);
  assert.equal(creditor.credit, 900);
  assert.equal(debtor.balance + creditor.balance, 700);
});

test('liveInvoiceStatus derives overdue state from due date', () => {
  assert.equal(svc.liveInvoiceStatus(invoice({ dueDate: new Date('2020-01-01T00:00:00Z'), paidAmount: 0 })), 'Overdue');
});
test('liveInvoiceStatus preserves Cancelled lifecycle state', () => assert.equal(svc.liveInvoiceStatus(invoice({ status: 'Cancelled' })), 'Cancelled'));

test('studentProgramId reads only canonical programId', () => {
  assert.equal(svc.studentProgramId({ programId: { _id: 'p1' }, subjects: [{ _id: 'wrong' }] }), 'p1');
});
test('studentAcademicLabel prefers canonical Program name', () => {
  assert.equal(svc.studentAcademicLabel({ programId: { name: 'Science' }, className: 'S4' }), 'Science');
});
test('studentAcademicLabel falls back to class placement', () => {
  assert.equal(svc.studentAcademicLabel({ className: 'S4', section: 'A', stream: 'Blue' }), 'S4 - A - Blue');
});

test('academicPeriodValues deduplicates and sorts years/terms', () => {
  const out = svc.academicPeriodValues([{ academicYear: '2025', term: '2' }, { academicYear: '2026', term: '1' }, { academicYear: '2025', term: '2' }]);
  assert.deepEqual(out.academicYears, ['2026', '2025']);
  assert.deepEqual(out.terms, ['1', '2']);
});
test('periodMatches applies academic year and term together', () => {
  assert.equal(svc.periodMatches({ academicYear: '2026', term: '2' }, { academicYear: '2026', term: '2' }), true);
  assert.equal(svc.periodMatches({ academicYear: '2026', term: '1' }, { academicYear: '2026', term: '2' }), false);
});
test('periodMatches supports all-period filters', () => assert.equal(svc.periodMatches({ academicYear: '2024', term: '3' }, { academicYear: 'all', term: 'all' }), true));

test('resolvePeriodRange all_time is unbounded', () => assert.deepEqual(svc.resolvePeriodRange('all_time', 'Africa/Kampala', new Date('2026-08-30T06:00:00Z')), { from: null, to: null }));
test('resolvePeriodRange today uses tenant-local midnight boundaries', () => {
  const out = svc.resolvePeriodRange('today', 'Africa/Kampala', new Date('2026-08-30T06:00:00Z'));
  assert.equal(out.from.toISOString(), '2026-08-29T21:00:00.000Z');
  assert.equal(out.to.toISOString(), '2026-08-30T20:59:59.999Z');
});
test('resolvePeriodRange last_30_days is exactly thirty tenant dates inclusive', () => {
  const out = svc.resolvePeriodRange('last_30_days', 'UTC', new Date('2026-08-30T12:00:00Z'));
  assert.equal(out.from.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(out.to.toISOString(), '2026-08-30T23:59:59.999Z');
});
test('resolvePeriodRange this_year uses tenant calendar year', () => {
  const out = svc.resolvePeriodRange('this_year', 'UTC', new Date('2026-08-30T12:00:00Z'));
  assert.equal(out.from.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(out.to.toISOString(), '2026-12-31T23:59:59.999Z');
});
test('resolvePeriodRange default month includes full current month', () => {
  const out = svc.resolvePeriodRange('this_month', 'UTC', new Date('2026-02-10T12:00:00Z'));
  assert.equal(out.from.toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(out.to.toISOString(), '2026-02-28T23:59:59.999Z');
});
test('dateInRange enforces both boundaries', () => {
  const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
  assert.equal(svc.dateInRange('2026-08-15T00:00:00Z', range), true);
  assert.equal(svc.dateInRange('2026-09-01T00:00:00Z', range), false);
});
