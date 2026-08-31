const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Finance routes fail closed on canonical Invoice + Payment models', () => {
  const admin = read('src/routes/tenant/admin/index.js');
  const student = read('src/routes/tenant/students/index.js');
  const parent = read('src/routes/tenant/parents/index.js');
  for (const src of [admin, student, parent]) assert.match(src, /\["Invoice", "Payment"\], \{ match: "all" \}/);
});

test('Payment model defaults fail-safe to Pending and has applied allocation field', () => {
  const src = read('src/models/tenant/Payment.js');
  assert.match(src, /appliedAmount:/);
  assert.match(src, /enum: \["Pending", "Completed", "Voided", "Refunded"\][\s\S]*default: "Pending"/);
  assert.match(src, /receiptNumber: 1/);
  assert.match(src, /unique: true/);
});

test('Invoice model has unique identifier and payment mutation lease', () => {
  const src = read('src/models/tenant/Invoice.js');
  assert.match(src, /invoiceNumber: 1/);
  assert.match(src, /unique: true/);
  assert.match(src, /paymentLeaseToken/);
  assert.match(src, /paymentLeaseExpiresAt/);
});

test('Admin Mark Paid creates settlement Payment instead of overwriting invoice balance', () => {
  const src = read('src/controllers/tenant/admin/invoicesController.js');
  assert.match(src, /settleInvoice\(req\.models/);
  assert.doesNotMatch(src, /markPaid[\s\S]{0,900}invoice\.balance\s*=\s*0/);
});

test('invoice edits acquire the same payment lease used by settlement', () => {
  const src = read('src/controllers/tenant/admin/invoicesController.js');
  assert.match(src, /update:[\s\S]*claimInvoicePaymentLease\(Invoice, req\.params\.id/);
  assert.match(src, /finally[\s\S]*releaseInvoicePaymentLease/);
});

test('Admin payment create/edit forms expose only Pending and Completed direct statuses', () => {
  const view = read('views/tenant/finance/payments.ejs');
  const modal = view.slice(view.indexOf('id="pStatus"'), view.indexOf('id="pPaymentDate"'));
  assert.match(modal, /Completed/);
  assert.match(modal, /Pending/);
  assert.doesNotMatch(modal, /Voided|Refunded/);
  const routes = read('src/routes/tenant/admin/payments.js');
  assert.match(routes, /\/:id\/complete/);
  assert.match(routes, /\/:id\/void/);
  assert.match(routes, /\/:id\/refund/);
});

test('Student and Parent finance use Invoice + Payment and ownership-scoped receipt lookup', () => {
  const student = read('src/controllers/tenant/students/financeController.js');
  const parent = read('src/controllers/tenant/parents/feesController.js');
  assert.match(student, /Invoice\.find/);
  assert.match(student, /Payment\.find/);
  assert.match(student, /studentId: student\._id/);
  assert.doesNotMatch(student, /Receipt\./);
  assert.match(parent, /Invoice\.find/);
  assert.match(parent, /Payment\.find/);
  assert.match(parent, /allowedIds\.has/);
});

test('Student and Parent account summaries use the shared Completed-only account snapshot', () => {
  const student = read('src/controllers/tenant/students/financeController.js');
  const parent = read('src/controllers/tenant/parents/feesController.js');
  const service = read('src/services/tenant/financeVisibilityService.js');
  assert.match(student, /accountSnapshot\(invoices, payments\)/);
  assert.match(parent, /accountSnapshot\(rawInvoices, rawPayments\)/);
  assert.match(service, /String\(payment\.status \|\| ''\) === 'Completed'/);
  assert.match(service, /unallocatedCredit/);
  assert.match(service, /balance: Math\.max\(0, net\)/);
});

test('Finance Reports use the shared account snapshot and Completed-only collection semantics', () => {
  const src = read('src/controllers/tenant/admin/financeReportsController.js');
  assert.match(src, /accountSnapshot\(studentInvoices, studentPayments\)/);
  assert.match(src, /String\(x\.status \|\| ""\) === "Completed"/);
  assert.match(src, /\["Recorded", "Approved"\]\.includes/);
  assert.match(src, /resolvePeriodRange\(clean\.period, req\.tenant\?\.timezone/);
});

test('Student Statements use canonical active-invoice and Completed-payment predicates', () => {
  const src = read('src/controllers/tenant/admin/studentStatementsController.js');
  assert.match(src, /studentInvoices\.filter\(activeInvoice\)/);
  assert.match(src, /studentPayments\.filter\(completedPayment\)/);
  assert.match(src, /accountSnapshot\(studentInvoices, studentPayments\)/);
});

test('live Finance reports/statements clients use safe DOM and server-side audited CSV exports', () => {
  for (const file of ['public/js/finance-reports.js', 'public/js/student-statements.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /innerHTML\s*=/, file);
    assert.match(src, /textContent|replaceChildren/);
    assert.doesNotMatch(src, /new Blob|createObjectURL/, file);
  }
  assert.match(read('src/controllers/tenant/admin/financeReportsController.js'), /storeCsvArtifact/);
  assert.match(read('src/controllers/tenant/admin/studentStatementsController.js'), /storeCsvArtifact/);
});

test('Finance JSON bootstraps are RCDATA-safe', () => {
  for (const file of ['views/tenant/finance/finance-reports.ejs', 'views/tenant/finance/student-statements.ejs']) {
    const src = read(file);
    assert.match(src, /replace\(\/<\/g, "\\\\u003c"\)/);
  }
});

test('receipt rendering uses canonical Payment and has no backend-later placeholder', () => {
  const view = read('views/tenant/finance/receipts/view.ejs');
  const client = read('public/js/finance-receipt.js');
  assert.match(view, /_payment\?\.receiptNumber/);
  assert.match(view, /receiptStatus/);
  assert.doesNotMatch(view + client, /backend later|next page|UI-only/i);
  assert.doesNotMatch(client, /innerHTML\s*=/);
});

test('Finance migration is wired before index synchronization and repairs identifiers/allocations', () => {
  const pkg = JSON.parse(read('package.json'));
  const indexes = read('scripts/create-indexes.js');
  const migration = read('scripts/lib/migrateFinance.js');
  assert.equal(pkg.scripts['migrate:finance'], 'node scripts/migrate-finance.js');
  assert.match(indexes, /migrateFinance\(tenantModels\)/);
  assert.match(migration, /repairIdentifiers\(Invoice/);
  assert.match(migration, /repairIdentifiers\(Payment/);
  assert.match(migration, /appliedAmount/);
  assert.match(migration, /mismatchedPaymentsDetached/);
});

test('active Finance views compile', () => {
  for (const file of [
    'views/tenant/finance/index.ejs',
    'views/tenant/finance/invoices.ejs',
    'views/tenant/finance/payments.ejs',
    'views/tenant/finance/finance-reports.ejs',
    'views/tenant/finance/student-statements.ejs',
    'views/tenant/finance/receipts/view.ejs',
    'views/students/finance.ejs',
    'views/parents/fees.ejs',
  ]) assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
});
