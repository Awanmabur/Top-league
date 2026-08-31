const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const {
  tenantDateKey,
  shiftDateKey,
  recentDateKeys,
  fillDailySeries,
  calculateStudentFinanceExposure,
} = require('../src/services/tenant/dashboardTruthService');

test('tenant dashboard date keys honor the tenant timezone', () => {
  assert.equal(tenantDateKey(new Date('2026-08-29T22:30:00Z'), 'Africa/Kampala'), '2026-08-30');
});

test('dashboard date-key shifting is date-only and crosses month boundaries safely', () => {
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDateKey('2024-03-01', -1), '2024-02-29');
});

test('dashboard recent date keys are bounded and include today', () => {
  const now = new Date('2026-08-30T08:00:00Z');
  const keys = recentDateKeys(now, 'Africa/Kampala', 15);
  assert.equal(keys.length, 15);
  assert.equal(keys.at(-1), '2026-08-30');
  assert.equal(recentDateKeys(now, 'UTC', 1000).length, 60);
});

test('dashboard daily series fills missing dates with zero without inventing values', () => {
  const rows = [{ _id: '2026-08-28', value: 3 }, { _id: '2026-08-30', value: 7 }];
  assert.deepEqual(fillDailySeries(rows, ['2026-08-28','2026-08-29','2026-08-30']), [3,0,7]);
});

test('finance exposure never nets one student credit against another student debt', () => {
  const result = calculateStudentFinanceExposure(
    [{ _id: 'A', outstanding: 40 }, { _id: 'B', outstanding: 100 }],
    [{ _id: 'A', received: 150, applied: 100 }],
  );
  assert.equal(result.outstanding, 100);
  assert.equal(result.studentsOwing, 1);
  assert.deepEqual(result.byStudent.get('A'), { balance: 0, credit: 10 });
  assert.deepEqual(result.byStudent.get('B'), { balance: 100, credit: 0 });
});

test('finance exposure treats only unallocated completed-payment value as account credit', () => {
  const result = calculateStudentFinanceExposure(
    [{ _id: 'A', outstanding: 100 }],
    [{ _id: 'A', received: 100, applied: 80 }],
  );
  assert.deepEqual(result.byStudent.get('A'), { balance: 80, credit: 0 });
  assert.equal(result.outstanding, 80);
});

test('finance exposure preserves payment-only account credit', () => {
  const result = calculateStudentFinanceExposure([], [{ _id: 'A', received: 75, applied: 0 }]);
  assert.deepEqual(result.byStudent.get('A'), { balance: 0, credit: 75 });
  assert.equal(result.outstanding, 0);
  assert.equal(result.studentsOwing, 0);
});

test('finance exposure clamps malformed negative amounts instead of creating negative debt', () => {
  const result = calculateStudentFinanceExposure(
    [{ _id: 'A', outstanding: -100 }],
    [{ _id: 'A', received: -50, applied: -20 }],
  );
  assert.deepEqual(result.byStudent.get('A'), { balance: 0, credit: 0 });
});

test('Parent shared child loader uses canonical Program and class fields', () => {
  const src = read('src/controllers/tenant/parents/_helpers.js');
  for (const field of ['programId','classId','className','classLevel','sectionId','streamId']) {
    assert.match(src, new RegExp(`\\b${field}\\b`), field);
  }
  assert.match(src, /populate\(\{ path: "programId"/);
  assert.doesNotMatch(src, /populate\(["']program["']/);
  assert.doesNotMatch(src, /populate\(["']classGroup["']/);
});

test('Parent shared child loader excludes deleted and archived linked Students', () => {
  const src = read('src/controllers/tenant/parents/_helpers.js');
  assert.match(src, /isDeleted: \{ \$ne: true \}/);
  assert.match(src, /status: \{ \$ne: "archived" \}/);
});

for (const file of [
  'src/controllers/tenant/parents/dashboardController.js',
  'src/controllers/tenant/parents/childrenController.js',
  'src/controllers/tenant/parents/profileController.js',
  'src/controllers/tenant/parents/supportController.js',
]) {
  test(`${file} uses the shared canonical linked-child loader`, () => {
    assert.match(read(file), /loadLinkedChildren/);
  });
}

test('Parent child detail loads one child through the shared access-controlled loader', () => {
  const src = read('src/controllers/tenant/parents/childViewsController.js');
  assert.match(src, /loadLinkedChild/);
  assert.match(src, /canAccessChild/);
});

test('Parent child detail uses shared account reconciliation instead of raw payment subtraction', () => {
  const src = read('src/controllers/tenant/parents/childViewsController.js');
  assert.match(src, /accountSnapshot\(invoiceRows, paymentRows\)/);
  assert.match(src, /unallocatedCredit: financeSnapshot\.unallocatedCredit/);
  assert.match(src, /balance: financeSnapshot\.balance/);
});

for (const file of [
  'views/parents/dashboard.ejs',
  'views/parents/children.ejs',
  'views/parents/profile.ejs',
  'views/parents/attendance.ejs',
  'views/parents/child-show.ejs',
]) {
  test(`${file} renders canonical Student Program/class fields`, () => {
    const src = read(file);
    assert.doesNotMatch(src, /\bc\.program\b|\bst\.program\b/);
    assert.doesNotMatch(src, /\bc\.classGroup\b|\bst\.classGroup\b/);
    assert.match(src, /programId|className|classLevel/);
  });
}

test('Student dashboard reconciles invoice debt with completed payment account credit', () => {
  const src = read('src/controllers/tenant/students/dashboardController.js');
  assert.match(src, /accountSnapshot\(invoices, payments\)/);
  assert.match(src, /feesDue = snapshot\.balance/);
  assert.match(src, /accountCredit = snapshot\.credit/);
  assert.match(src, /status: "Completed"/);
});

test('Student dashboard presents account credit distinctly from outstanding debt', () => {
  const src = read('views/students/dashboard.ejs');
  assert.match(src, /statsData\.accountCredit/);
  assert.match(src, /Account credit/);
});

test('Admin dashboard counts current enrollment rather than graduated or archived Students', () => {
  const src = read('src/controllers/tenant/admin/dashboardController.js');
  assert.match(src, /status: \{ \$in: \["active", "on_hold", "suspended"\] \}/);
  assert.doesNotMatch(src, /status: \{ \$nin: \["archived"\] \}/);
});

test('Admin dashboard uses shared per-student finance exposure for total and recent balances', () => {
  const src = read('src/controllers/tenant/admin/dashboardController.js');
  assert.match(src, /calculateStudentFinanceExposure\(invoiceExposureAgg, paymentExposureAgg\)/);
  assert.match(src, /financeExposure\.byStudent\.get\(String\(s\._id\)\)\?\.balance/);
});

test('Admin dashboard trends are real tenant-timezone aggregates rather than synthetic interpolation', () => {
  const src = read('src/controllers/tenant/admin/dashboardController.js');
  assert.match(src, /\$dateToString:[\s\S]*timezone/);
  assert.match(src, /fillDailySeries\(studentTrendAgg, trendDateKeys\)/);
  assert.match(src, /fillDailySeries\(applicantTrendAgg, trendDateKeys\)/);
  assert.match(src, /fillDailySeries\(feesTrendAgg, trendDateKeys\)/);
  assert.doesNotMatch(src, /buildSoftTrend|buildFlatTrend/);
});

test('Admin dashboard does not fabricate a system-health history when only a current snapshot exists', () => {
  const src = read('src/controllers/tenant/admin/dashboardController.js');
  assert.match(src, /uptimeTrend: \[\]/);
});

test('Admin dashboard browser rendering contains no data-backed HTML insertion APIs', () => {
  const src = read('public/js/index.js');
  assert.doesNotMatch(src, /\.innerHTML\s*=|insertAdjacentHTML/);
  assert.match(src, /createElementNS/);
  assert.match(src, /textContent/);
  assert.match(src, /replaceChildren/);
});

test('Admin dashboard browser restricts server-provided chart colors before assigning SVG/CSS values', () => {
  const src = read('public/js/index.js');
  assert.match(src, /function safeColor/);
  assert.match(src, /\^#\[0-9a-fA-F\]\{3,8\}\$/);
});

const deadPaths = [
  'src/routes/tenant/admin/invitation.js',
  'src/routes/tenant/admin/levels.js',
  'src/routes/tenant/admin/register.js',
  'src/routes/tenant/admin/tenant.js',
  'src/controllers/tenant/admin/adminApprovalController.js',
  'src/controllers/tenant/admin/feesController.js',
  'src/controllers/tenant/admin/financeDashboardController.js',
  'src/controllers/tenant/admin/levelsController.js',
  'src/controllers/tenant/admin/registerController.js',
  'src/controllers/tenant/admin/registerStaffController.js',
  'src/controllers/tenant/admin/registerStudentController.js',
  'src/controllers/tenant/admin/reviewController.js',
  'src/controllers/tenant/admin/setPasswordController.js',
  'src/controllers/tenant/admin/staffRolesController.js',
  'src/controllers/tenant/admin/tenantSchoolProfileController.js',
  'src/middleware/tenant/uploadApplicantDocs.js',
  'src/middleware/tenant/uploadCSV.js',
  'src/middleware/uploads/applicantUploads.js',
  'src/services/tenant/inviteService.js',
  'src/services/tenant/gpaService.js',
  'src/services/tenant/notify.js',
  'src/services/tenant/tenantProfileCloudinaryService.js',
  'src/utils/academicHierarchy.js',
  'src/utils/academicPlacement.js',
  'src/utils/academicScope.js',
  'views/tenant/levels/index.ejs',
  'public/js/levels.js',
  'views/tenant/fees/index.ejs',
  'public/js/fees.js',
  'public/js/tenant.js',
];

for (const file of deadPaths) {
  test(`dead legacy path remains removed: ${file}`, () => {
    assert.equal(exists(file), false);
  });
}

test('active Admin route index mounts only the canonical academic and finance surfaces', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.doesNotMatch(src, /require\(["']\.\/levels["']\)/);
  assert.doesNotMatch(src, /require\(["']\.\/register["']\)/);
  assert.doesNotMatch(src, /require\(["']\.\/tenant["']\)/);
  assert.match(src, /require\(["']\.\/feeStructures["']\)/);
  assert.match(src, /require\(["']\.\/programs["']\)/);
});

test('the invitation compatibility alias remains on the hardened canonical invite contract', () => {
  const src = read('src/controllers/tenant/admin/inviteAuthController.js');
  assert.match(src, /Compatibility alias/);
  assert.match(src, /require\(["']\.\.\/tenant\/inviteAuthController["']\)/);
});

test('migration-required legacy PlatformSetting model remains present', () => {
  assert.equal(exists('src/models/platform/PlatformSetting.js'), true);
  const migration = read('scripts/lib/migratePlatformOperations.js');
  assert.match(migration, /PlatformSetting/);
});

test('dynamic tenant model registry remains intact after source cleanup', () => {
  const src = read('src/models/tenant/loadModels.js');
  assert.match(src, /defineModel\("Program"\)/);
  assert.match(src, /defineModel\("Department"\)/);
  assert.match(src, /defineModel\("Fees"\)/);
  assert.match(src, /Object\.defineProperty\(models, key/);
});

for (const file of [
  'views/parents/dashboard.ejs',
  'views/parents/children.ejs',
  'views/parents/profile.ejs',
  'views/parents/attendance.ejs',
  'views/parents/child-show.ejs',
  'views/students/dashboard.ejs',
  'views/tenant/dashboard/index.ejs',
]) {
  test(`modified portal template compiles: ${file}`, () => {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }));
  });
}
