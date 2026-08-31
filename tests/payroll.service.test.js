const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMonth,
  normalizeYear,
  calculatePayrollItem,
  payrollScopeKey,
  runNumberCandidate,
  runTransitionAllowed,
  csvCell,
  escapeRegex,
  eligibleStaffFilter,
  acquireRunLock,
  releaseRunLock,
} = require('../src/services/tenant/payrollService');

test('payroll month/year normalization is canonical and fail closed', () => {
  assert.equal(normalizeMonth(' march '), 'March');
  assert.equal(normalizeMonth('Smarch'), null);
  assert.equal(normalizeYear('2026'), 2026);
  assert.equal(normalizeYear('1999'), null);
});

test('payroll item math derives gross/net and rejects over-deductions', () => {
  assert.deepEqual(calculatePayrollItem({ basicSalary: 1000, allowances: 200, bonuses: 50, deductions: 150 }), {
    basicSalary: 1000, allowances: 200, bonuses: 50, deductions: 150, grossPay: 1250, netPay: 1100,
  });
  assert.throws(() => calculatePayrollItem({ basicSalary: 100, deductions: 101 }), /cannot exceed gross/);
});

test('payroll scope key separates department scope and all-school scope', () => {
  assert.equal(payrollScopeKey(2026, 'August', null), '2026-08:ALL');
  assert.equal(payrollScopeKey(2026, 'August', 'dep1'), '2026-08:dep1');
});

test('payroll run number is dated and cryptographically suffixed', () => {
  assert.match(runNumberCandidate(new Date('2026-08-29T10:00:00Z')), /^PAY-20260829-[0-9A-F]{10}$/);
});

test('payroll run lifecycle is strictly forward-only', () => {
  assert.equal(runTransitionAllowed('Draft', 'Processed'), true);
  assert.equal(runTransitionAllowed('Processed', 'Approved'), true);
  assert.equal(runTransitionAllowed('Approved', 'Closed'), true);
  assert.equal(runTransitionAllowed('Approved', 'Draft'), false);
  assert.equal(runTransitionAllowed('Draft', 'Approved'), false);
});

test('payroll CSV output neutralizes spreadsheet formulas', () => {
  assert.match(csvCell('=HYPERLINK("bad")'), /^"'/);
  assert.equal(csvCell('Normal'), '"Normal"');
});

test('payroll search regex escapes user metacharacters', () => {
  assert.equal(escapeRegex('A+B[1]'), 'A\\+B\\[1\\]');
});

test('eligible payroll staff excludes suspended/exited/deleted staff', () => {
  const f = eligibleStaffFilter('dep1');
  assert.deepEqual(f.status.$in, ['Active', 'On Leave']);
  assert.deepEqual(f.isDeleted, { $ne: true });
  assert.equal(f.departmentId, 'dep1');
});

test('per-run payroll lease is acquired atomically and token-guarded on release', async () => {
  let acquireFilter, releaseFilter;
  const models = { PayrollRun: {
    findOneAndUpdate(filter) { acquireFilter = filter; return Promise.resolve({ _id: 'r1', status: 'Draft' }); },
    updateOne(filter) { releaseFilter = filter; return Promise.resolve({ modifiedCount: 1 }); },
  } };
  const lease = await acquireRunLock(models, 'r1', new Date('2026-08-29T10:00:00Z'));
  assert.ok(lease.token);
  assert.equal(acquireFilter._id, 'r1');
  assert.ok(acquireFilter.$or.some((x) => x['ops.lockUntil']?.$lte));
  await releaseRunLock(models, 'r1', lease.token);
  assert.equal(releaseFilter['ops.lockToken'], lease.token);
});

test('busy payroll run lease fails closed', async () => {
  const models = { PayrollRun: { findOneAndUpdate: async () => null } };
  await assert.rejects(() => acquireRunLock(models, 'r1'), /busy/);
});
