const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const studentFinance = read('src/controllers/tenant/students/financeController.js');
const parentFees = read('src/controllers/tenant/parents/feesController.js');
const financeReports = read('src/controllers/tenant/admin/financeReportsController.js');
const statements = read('src/controllers/tenant/admin/studentStatementsController.js');
const adminRoutes = read('src/routes/tenant/admin/index.js');

test('Student Finance exposes real academic year and term GET filters', () => {
  const view = read('views/students/finance.ejs');
  assert.match(view, /form method="get" action="\/student\/finance"/);
  assert.match(view, /name="academicYear"/);
  assert.match(view, /name="term"/);
  assert.match(studentFinance, /periodMatches\(row, filters\)/);
});
test('Student Finance derives filter options from invoice/payment records', () => assert.match(studentFinance, /academicPeriodValues\(\[\.\.\.\(allInvoices/));
test('Student Finance uses shared account snapshot rather than raw payment subtraction', () => assert.match(studentFinance, /const totals = accountSnapshot\(invoices, payments\)/));
test('Student Finance receipt history distinguishes status and Completed receipts', () => {
  const view = read('views/students/finance.ejs');
  assert.match(view, /<th[^>]*>Status<\/th>/);
  assert.match(studentFinance, /recentReceipts = totals\.completedPayments/);
});
test('Student Finance page and receipt are private no-store', () => {
  assert.ok((studentFinance.match(/Cache-Control", "private, no-store"/g) || []).length >= 2);
});

test('Parent Fees child query uses canonical programId and class fields', () => {
  assert.match(parentFees, /programId classId className classLevel/);
  assert.match(parentFees, /populate\(\{ path: "programId"/);
  assert.doesNotMatch(parentFees, /populate\(["']program["']/);
  assert.doesNotMatch(parentFees, /populate\(["']classGroup["']/);
});
test('Parent Fees child query filters deleted and archived Students', () => {
  assert.match(parentFees, /isDeleted: \{ \$ne: true \}/);
  assert.match(parentFees, /status: \{ \$ne: "archived" \}/);
});

test('Parent Fees does not hide database/populate errors as an empty child list', () => assert.doesNotMatch(parentFees, /\.lean\(\)\.catch\(\(\) => \[\]\)/));
test('Parent Fees view no longer dereferences nonexistent classGroup', () => assert.doesNotMatch(read('views/parents/fees.ejs'), /classGroup/));
test('Parent Fees exposes account credit separately from net amount due', () => {
  const view = read('views/parents/fees.ejs');
  assert.match(view, /Account credit/);
  assert.match(view, /sum\.unallocatedCredit/);
  assert.match(view, /Net Amount Due/);
});
test('Parent Fees page and receipt are private no-store', () => assert.ok((parentFees.match(/Cache-Control", "private, no-store"/g) || []).length >= 2));

test('Admin finance surfaces fail closed on Student Invoice Payment Program and ReportExport', () => {
  for (const route of ['student-statements', 'finance-reports']) {
    const line = adminRoutes.split('\n').find((row) => row.includes(`router.use("/${route}"`)) || '';
    for (const model of ['Student', 'Invoice', 'Payment', 'Program', 'ReportExport']) assert.match(line, new RegExp(`"${model}"`), `${route}:${model}`);
  }
});
test('Finance Reports uses Program and canonical student programId, never Subject subjects', () => {
  assert.match(financeReports, /\{ Invoice, Payment, Expense, Scholarship, Student, Program \}/);
  assert.match(financeReports, /studentProgramId/);
  assert.doesNotMatch(financeReports, /\bSubject\b/);
  assert.doesNotMatch(financeReports, /\.subjects\b/);
});
test('Finance Reports uses tenant-timezone range semantics', () => assert.match(financeReports, /resolvePeriodRange\(clean\.period, req\.tenant\?\.timezone \|\| "UTC"\)/));
test('Finance Reports derives student balances per student to prevent cross-account netting', () => {
  assert.match(financeReports, /students\.map\(\(student\) =>/);
  assert.match(financeReports, /accountSnapshot\(studentInvoices, studentPayments\)/);
  assert.match(financeReports, /outstanding = balancesByStudent\.reduce/);
});
test('Finance Reports exposes invoice outstanding and account credit separately', () => {
  assert.match(financeReports, /invoiceOutstanding: snapshot\.invoiceOutstanding/);
  assert.match(financeReports, /unallocatedCredit: snapshot\.unallocatedCredit/);
  assert.match(financeReports, /credit: snapshot\.credit/);
  assert.match(read('views/tenant/finance/finance-reports.ejs'), /Account Credit/);
});
test('Finance Reports counts Completed payments only as collections', () => assert.match(financeReports, /String\(x\.status \|\| ""\) === "Completed"/));

test('Finance Reports refuses to calculate scoped net when Expense has no student/program key', () => {
  assert.match(financeReports, /const netComparable = clean\.program === "all" && clean\.student === "all"/);
  assert.match(financeReports, /net: netComparable \? collected - expensesTotal : null/);
  assert.match(read('views/tenant/finance/finance-reports.ejs'), /Expenses have no student\/program scope/);
});
test('Finance Reports page is private no-store', () => assert.match(financeReports, /res\.set\("Cache-Control", "private, no-store"\)/));

test('Finance Reports page and export share one snapshot builder', () => assert.ok((financeReports.match(/buildFinanceReportSnapshot\(req\)/g) || []).length >= 2));
test('Finance Reports export uses authenticated report artifact lifecycle', () => {
  assert.match(financeReports, /storeCsvArtifact\(\{/);
  assert.match(financeReports, /type: "finance_summary"/);
  assert.match(financeReports, /reportSurface: "finance_reports"/);
  assert.match(financeReports, /subfolder: "finance-reports"/);
});
test('Finance Reports CSV uses shared formula-safe csvCell', () => assert.match(financeReports, /row\.map\(reportCtl\.csvCell\)/));
test('Finance Reports browser client no longer creates Blob CSVs', () => {
  const client = read('public/js/finance-reports.js');
  assert.doesNotMatch(client, /new Blob|createObjectURL/);
  assert.match(client, /\/admin\/finance-reports\/export/);
});

test('Student Statements uses canonical Program and programId, never Subject', () => {
  assert.match(statements, /\{ Student, Invoice, Payment, Program \}/);
  assert.match(statements, /studentProgramId\(s\)/);
  assert.doesNotMatch(statements, /\bSubject\b/);
});
test('Student Statements filters academic year and term at student scope', () => {
  assert.match(statements, /clean\.term !== "all"/);
  assert.match(statements, /clean\.academicYear !== "all"/);
  const view = read('views/tenant/finance/student-statements.ejs');
  assert.match(view, /name="academicYear"/);
  assert.match(view, /name="term"/);
});
test('Student Statements labels Program instead of Subject in live UI', () => {
  const view = read('views/tenant/finance/student-statements.ejs');
  const client = read('public/js/student-statements.js');
  assert.doesNotMatch(view, /All Subjects|Subject \/ Class/);
  assert.doesNotMatch(client, /Subject \/ Class/);
  assert.match(view, /All Programs/);
});
test('Student Statements use active invoice and Completed payment predicates', () => {
  assert.match(statements, /studentInvoices\.filter\(activeInvoice\)/);
  assert.match(statements, /studentPayments\.filter\(completedPayment\)/);
});
test('Student Statements expose invoice outstanding, unallocated credit and net credit', () => {
  assert.match(statements, /invoiceOutstanding: snapshot\.invoiceOutstanding/);
  assert.match(statements, /unallocatedCredit: snapshot\.unallocatedCredit/);
  assert.match(statements, /creditBalance: snapshot\.credit/);
});
test('Student Statements page and export share one snapshot builder', () => assert.ok((statements.match(/buildStatementsSnapshot\(req\)/g) || []).length >= 2));
test('Student Statements export uses authenticated report artifact lifecycle', () => {
  assert.match(statements, /storeCsvArtifact\(\{/);
  assert.match(statements, /type: "students_outstanding"/);
  assert.match(statements, /reportSurface: "student_statements"/);
  assert.match(statements, /subfolder: "student-statements"/);
});
test('Student Statements CSV uses shared formula-safe csvCell', () => assert.match(statements, /row\.map\(reportCtl\.csvCell\)/));
test('Student Statements browser client exports through server endpoint', () => {
  const client = read('public/js/student-statements.js');
  assert.doesNotMatch(client, /new Blob|createObjectURL/);
  assert.match(client, /\/admin\/student-statements\/export/);
  assert.match(client, /params\.set\("student", studentId\)/);
});

test('finance report and statement routes expose export before index', () => {
  for (const file of ['src/routes/tenant/admin/financeReports.js', 'src/routes/tenant/admin/studentStatements.js']) {
    const src = read(file);
    assert.match(src, /router\.get\("\/export", ctrl\.exportCsv\);[\s\S]*router\.get\("\/", ctrl\.index\);/);
  }
});
test('Finance report and statement JSON bootstraps remain RCDATA escaped', () => {
  for (const file of ['views/tenant/finance/finance-reports.ejs', 'views/tenant/finance/student-statements.ejs']) assert.match(read(file), /replace\(\/<\/g, "\\\\u003c"\)/);
});
test('changed finance browser clients avoid database-backed innerHTML', () => {
  for (const file of ['public/js/finance-reports.js', 'public/js/student-statements.js']) assert.doesNotMatch(read(file), /innerHTML\s*=/, file);
});
test('shared receipt view does not call Pending records proof of payment', () => {
  const view = read('views/tenant/finance/receipts/view.ejs');
  assert.match(view, /Payment Record/);
  assert.match(view, /must not be treated as proof of completed payment/i);
});
test('all four modified finance templates compile', () => {
  for (const file of ['views/students/finance.ejs', 'views/parents/fees.ejs', 'views/tenant/finance/finance-reports.ejs', 'views/tenant/finance/student-statements.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});
