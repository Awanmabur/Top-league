const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin payroll route uses canonical payroll permission and complete financial model guard', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.match(src, /"\/payroll",\s*requireTenantPermission\("payroll\.view"\)/);
  for (const model of ['PayrollRun', 'PayrollItem', 'Staff', 'Expense']) assert.ok(src.includes(`"${model}"`), model);
});

test('finance built-in role has payroll view/manage permissions', () => {
  const src = read('src/utils/tenantRoles.js');
  assert.match(src, /"payroll\.view"/);
  assert.match(src, /"payroll\.manage"/);
});

test('payroll creation snapshots canonical Staff.salary and eligible employment status', () => {
  const src = read('src/services/tenant/payrollService.js');
  assert.match(src, /basicSalary:\s*staff\.salary/);
  assert.match(src, /status:\s*\{ \$in: \['Active', 'On Leave'\] \}/);
  assert.doesNotMatch(src, /staff\.basicSalary/);
});

test('payroll models have immutable identifiers, operation lease, snapshots and payment evidence fields', () => {
  const run = read('src/models/tenant/PayrollRun.js');
  const item = read('src/models/tenant/PayrollItem.js');
  assert.match(run, /runNumber/); assert.match(run, /scopeKey/); assert.match(run, /unique:\s*true/); assert.match(run, /ops/);
  for (const marker of ['staffName', 'employeeId', 'payrollNumber', 'departmentName', 'paidAt', 'paymentReference', 'heldReason']) assert.ok(item.includes(marker), marker);
});

test('admin payroll lifecycle routes include real pay/item/export actions and no draft reset route', () => {
  const routes = read('src/routes/tenant/admin/payroll.js');
  for (const marker of ['/export.csv', '/:id/pay', '/:id/items/:itemId/update', '/:id/items/:itemId/hold', '/:id/items/:itemId/release', '/:id/items/:itemId/pay']) assert.ok(routes.includes(marker), marker);
  const controller = read('src/controllers/tenant/admin/payrollController.js');
  assert.match(controller, /markRunPaid/); assert.match(controller, /closeRun/); assert.match(controller, /csvCell/);
});

test('closing payroll requires paid items and creates a Salary expense', () => {
  const src = read('src/services/tenant/payrollService.js');
  assert.match(src, /All payroll items must be paid/);
  assert.match(src, /category:\s*'Salary'/);
  assert.match(src, /status:\s*'Approved'/);
  assert.match(src, /expenseId/);
});

test('staff payroll only exposes Approved/Closed runs and processed/paid/held items', () => {
  const src = read('src/controllers/tenant/staff/payrollController.js');
  assert.match(src, /\['Approved', 'Closed'\]/);
  assert.match(src, /\['Processed', 'Paid', 'Held'\]/);
  assert.match(src, /staffId:\s*staff\._id/);
});

test('staff dashboard uses canonical Pending leave and real net payroll values', () => {
  const controller = read('src/controllers/tenant/staff/dashboardController.js');
  const view = read('views/staff/dashboard.ejs');
  assert.match(controller, /status:\s*"Pending"/);
  assert.doesNotMatch(controller, /status:\s*"pending"/);
  assert.match(view, /item\.netPay/);
  assert.doesNotMatch(view, /item\.amount/);
});

test('admin Payroll JSON is RCDATA-safe and client avoids database-backed innerHTML', () => {
  const view = read('views/tenant/staff/payroll.ejs');
  const js = read('public/js/payroll.js');
  assert.match(view, /\\u0026/); assert.match(view, /\\u003c/); assert.match(view, /\\u003e/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /replaceChildren/);
  assert.doesNotMatch(js, /Hook payroll export route later/);
});

test('payroll migration runs before indexes and has explicit package command', () => {
  const indexes = read('scripts/create-indexes.js');
  const migration = read('scripts/lib/migratePayroll.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(indexes, /migratePayroll\(tenantModels\)/);
  assert.match(migration, /repairedRunNumbers/);
  assert.match(migration, /duplicateItems/);
  assert.equal(pkg.scripts['migrate:payroll'], 'node scripts/migrate-payroll.js');
});

test('staff payroll route fails closed unless Staff + PayrollRun + PayrollItem exist', () => {
  const src = read('src/routes/tenant/staff/index.js');
  assert.match(src, /requireTenantModels\(\["Staff", "PayrollRun", "PayrollItem"\], \{ match: "all" \}\), require\("\.\/payroll"\)/);
});

test('active Payroll EJS templates compile', () => {
  for (const file of ['views/tenant/staff/payroll.ejs', 'views/staff/payroll.ejs', 'views/staff/dashboard.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});
