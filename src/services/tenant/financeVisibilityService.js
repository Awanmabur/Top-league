const { safeAmount, deriveInvoiceStatus } = require('./financeService');
const { dateOnlyBoundary } = require('./reportControlService');

function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

function idOf(value) {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

function programName(program) {
  if (!program) return '';
  return str(program.name || program.title || program.shortTitle || program.programName || program.code || '', 180);
}

function studentProgramId(student) {
  return idOf(student?.programId);
}

function studentAcademicLabel(student) {
  const program = programName(student?.programId);
  if (program) return program;
  const parts = [student?.className || student?.classLevel, student?.section, student?.stream]
    .map((v) => str(v, 120))
    .filter(Boolean);
  return parts.length ? parts.join(' - ') : '—';
}

function activeInvoice(invoice) {
  return Boolean(invoice && invoice.isDeleted !== true && !['Draft', 'Cancelled'].includes(String(invoice.status || '')));
}

function completedPayment(payment) {
  return Boolean(payment && payment.isDeleted !== true && String(payment.status || '') === 'Completed');
}

function invoiceOutstanding(invoice) {
  if (!activeInvoice(invoice)) return 0;
  const total = Math.max(0, safeAmount(invoice.totalAmount, 0));
  const rawBalance = Number(invoice.balance);
  if (Number.isFinite(rawBalance)) return Math.max(0, Math.min(total, rawBalance));
  return Math.max(0, total - Math.max(0, safeAmount(invoice.paidAmount, 0)));
}

function paymentAppliedAmount(payment) {
  if (!completedPayment(payment)) return 0;
  const amount = Math.max(0, safeAmount(payment.amount, 0));
  const raw = payment.appliedAmount;
  if (raw === undefined || raw === null || raw === '') {
    return payment.invoiceId ? amount : 0;
  }
  return Math.max(0, Math.min(amount, safeAmount(raw, 0)));
}

function accountSnapshot(invoices = [], payments = []) {
  const activeInvoices = (invoices || []).filter(activeInvoice);
  const completedPayments = (payments || []).filter(completedPayment);

  const billed = activeInvoices.reduce((sum, invoice) => sum + Math.max(0, safeAmount(invoice.totalAmount, 0)), 0);
  const invoiceOutstandingTotal = activeInvoices.reduce((sum, invoice) => sum + invoiceOutstanding(invoice), 0);
  const received = completedPayments.reduce((sum, payment) => sum + Math.max(0, safeAmount(payment.amount, 0)), 0);
  const applied = completedPayments.reduce((sum, payment) => sum + paymentAppliedAmount(payment), 0);
  const unallocatedCredit = Math.max(0, received - applied);
  const net = invoiceOutstandingTotal - unallocatedCredit;

  return {
    billed,
    paid: received,
    received,
    applied,
    invoiceOutstanding: invoiceOutstandingTotal,
    unallocatedCredit,
    balance: Math.max(0, net),
    credit: Math.max(0, -net),
    invoiceCount: activeInvoices.length,
    paymentCount: completedPayments.length,
    activeInvoices,
    completedPayments,
  };
}

function liveInvoiceStatus(invoice) {
  if (!invoice) return 'Unpaid';
  return deriveInvoiceStatus({
    totalAmount: Math.max(0, safeAmount(invoice.totalAmount, 0)),
    paidAmount: Math.max(0, safeAmount(invoice.paidAmount, 0)),
    dueDate: invoice.dueDate,
    status: invoice.status,
  });
}

function academicPeriodValues(rows = []) {
  const years = new Set();
  const terms = new Set();
  for (const row of rows || []) {
    const year = str(row?.academicYear, 30);
    const term = str(row?.term, 30);
    if (year) years.add(year);
    if (term) terms.add(term);
  }
  return {
    academicYears: [...years].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    terms: [...terms].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  };
}

function periodMatches(row, filters = {}) {
  const year = str(filters.academicYear || 'all', 30);
  const term = str(filters.term || 'all', 30);
  if (year !== 'all' && str(row?.academicYear, 30) !== year) return false;
  if (term !== 'all' && str(row?.term, 30) !== term) return false;
  return true;
}

function tenantDateParts(date = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}

function dateKeyFromParts(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(parts, days) {
  const d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function resolvePeriodRange(period, timezone = 'UTC', now = new Date()) {
  const p = str(period || 'this_month', 30);
  if (p === 'all_time') return { from: null, to: null };
  const parts = tenantDateParts(now, timezone);
  const today = dateKeyFromParts(parts);

  if (p === 'today') {
    return { from: dateOnlyBoundary(today, timezone, false), to: dateOnlyBoundary(today, timezone, true) };
  }
  if (p === 'last_30_days') {
    return { from: dateOnlyBoundary(shiftDateKey(parts, -29), timezone, false), to: dateOnlyBoundary(today, timezone, true) };
  }
  if (p === 'this_year') {
    return {
      from: dateOnlyBoundary(`${parts.year}-01-01`, timezone, false),
      to: dateOnlyBoundary(`${parts.year}-12-31`, timezone, true),
    };
  }

  const y = Number(parts.year);
  const m = Number(parts.month);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: dateOnlyBoundary(`${parts.year}-${parts.month}-01`, timezone, false),
    to: dateOnlyBoundary(`${parts.year}-${parts.month}-${String(lastDay).padStart(2, '0')}`, timezone, true),
  };
}

function dateInRange(dateValue, range) {
  if (!dateValue) return !range?.from && !range?.to;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  if (range?.from && date < range.from) return false;
  if (range?.to && date > range.to) return false;
  return true;
}

module.exports = {
  idOf,
  programName,
  studentProgramId,
  studentAcademicLabel,
  activeInvoice,
  completedPayment,
  invoiceOutstanding,
  paymentAppliedAmount,
  accountSnapshot,
  liveInvoiceStatus,
  academicPeriodValues,
  periodMatches,
  resolvePeriodRange,
  dateInRange,
};
