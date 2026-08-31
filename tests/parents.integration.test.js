const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Parent model persists portal profile fields and unique active identity links', () => {
  const src = read('src/models/tenant/Parent.js');
  for (const field of ['addressLine1','addressLine2','city','country','occupation']) assert.match(src, new RegExp(`${field}:`));
  assert.match(src, /\{ email: 1 \}[\s\S]*unique: true/);
  assert.match(src, /\{ userId: 1 \}[\s\S]*unique: true/);
});

test('tenant User records distinguish parent-lifecycle suspension from manual suspension', () => {
  const src = read('src/models/tenant/User.js');
  assert.match(src, /parentAccessSuspended:\s*\{ type: Boolean, default: false \}/);
  assert.match(src, /parentAccessPreviousStatus/);
});

test('manual User status mutations clear Parent suspension ownership', () => {
  const src = read('src/controllers/tenant/admin/usersController.js');
  const clears = src.match(/parentAccessSuspended:\s*false/g) || [];
  assert.ok(clears.length >= 5, `expected manual status paths to clear Parent suspension ownership, found ${clears.length}`);
  assert.match(src, /parentAccessPreviousStatus:\s*null/);
});

test('Admin Parents route uses canonical permission middleware with manage escalation on writes', () => {
  const index = read('src/routes/tenant/admin/index.js');
  const middleware = read('src/middleware/tenant/requireTenantPermission.js');
  assert.match(index, /router\.use\("\/parents", requireTenantPermission\("parents\.view"\)/);
  assert.match(middleware, /return `\$\{base\}\.manage`/);
});

test('Admin Parents exposes real CSV import/export and shared lifecycle actions', () => {
  const routes = read('src/routes/tenant/admin/parents.js');
  const ctrl = read('src/controllers/tenant/admin/parentsController.js');
  assert.match(routes, /router\.get\("\/export", ctrl\.exportCsv\)/);
  assert.match(routes, /router\.post\("\/import", upload\.single\("file"\), ctrl\.importCsv\)/);
  assert.match(ctrl, /applyParentLifecycle\(/);
  assert.match(ctrl, /validateChildren\(/);
  assert.match(ctrl, /assertParentAccountCompatibility/);
  assert.match(ctrl, /CSV import is limited to 1,999 rows/);
});

test('new Parent CSV rows roll back when account linkage fails instead of reporting a partial import', () => {
  const ctrl = read('src/controllers/tenant/admin/parentsController.js');
  assert.match(ctrl, /await Parent\.deleteOne\(\{ _id: parent\._id \}\)\.catch/);
  assert.match(ctrl, /account linkage failed/);
});

test('Parent portal authentication requires a linked active Parent record', () => {
  const auth = read('src/middleware/tenant/requireTenantAuth.js');
  assert.match(auth, /primaryRole === "parent"/);
  assert.match(auth, /userId: user\._id/);
  assert.match(auth, /status: \{ \$in: \["active", "on_hold"\] \}/);
  assert.match(auth, /Parent access disabled/);
});

test('Parent profile synchronizes the linked User identity and validates email ownership', () => {
  const ctrl = read('src/controllers/tenant/parents/profileController.js');
  assert.match(ctrl, /assertParentEmailOwnership/);
  assert.match(ctrl, /syncParentIdentity/);
  assert.match(ctrl, /runValidators: true/);
  assert.doesNotMatch(ctrl, /deletedAt: null/);
});

test('Parent child/profile views use the canonical linked-child loader that excludes deleted or archived Students', () => {
  const helper = read('src/controllers/tenant/parents/_helpers.js');
  assert.match(helper, /isDeleted: \{ \$ne: true \}/);
  assert.match(helper, /status: \{ \$ne: ["']archived["'] \}/);
  assert.match(helper, /programId/);
  assert.doesNotMatch(helper, /populate\(["']program["']/);
  assert.doesNotMatch(helper, /populate\(["']classGroup["']/);
  for (const file of [
    'src/controllers/tenant/parents/profileController.js',
    'src/controllers/tenant/parents/childrenController.js',
  ]) {
    assert.match(read(file), /loadLinkedChildren/, file);
  }
});

test('Parent Admin client uses safe DOM rendering and server-filtered export', () => {
  const client = read('public/js/parents.js');
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
  assert.match(client, /replaceChildren/);
  assert.match(client, /textContent/);
  assert.match(client, /\/admin\/parents\/export/);
});

test('Parent JSON bootstrap is RCDATA-safe and mutating forms preserve CSRF', () => {
  const view = read('views/tenant/parents/index.ejs');
  assert.match(view, /JSON\.stringify\([\s\S]*?\.replace\(\/<\/g, "\\\\u003c"\)/);
  const csrf = view.match(/name="_csrf"/g) || [];
  assert.ok(csrf.length >= 4, `expected CSRF fields on Parent mutations, found ${csrf.length}`);
});

test('Parent migration repairs duplicate identity links and never claims a manual suspension', () => {
  const migration = read('scripts/lib/migrateParents.js');
  const indexes = read('scripts/create-indexes.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(migration, /mergedDuplicates/);
  assert.match(migration, /usedUsers/);
  assert.match(migration, /user\.status !== 'suspended'/);
  assert.match(migration, /parentAccessPreviousStatus/);
  assert.match(indexes, /migrateParents\(tenantModels\)/);
  assert.equal(pkg.scripts['migrate:parents'], 'node scripts/migrate-parents.js');
});

test('active Parent Admin and portal profile views compile', () => {
  for (const file of ['views/tenant/parents/index.ejs','views/parents/profile.ejs','views/parents/children.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});

test('all active Parent child selectors filter deleted/archived Students directly or through the shared loader', () => {
  const helper = read('src/controllers/tenant/parents/_helpers.js');
  assert.match(helper, /isDeleted: \{ \$ne: true \}/);
  assert.match(helper, /status: \{ \$ne: ["']archived["'] \}/);

  for (const file of [
    'src/controllers/tenant/parents/dashboardController.js',
    'src/controllers/tenant/parents/supportController.js',
  ]) {
    assert.match(read(file), /loadLinkedChildren/, file);
  }

  for (const file of [
    'src/controllers/tenant/parents/attendanceController.js',
    'src/controllers/tenant/parents/feesController.js',
    'src/controllers/tenant/parents/resultsController.js',
    'src/controllers/tenant/parents/timetableController.js',
  ]) {
    const src = read(file);
    assert.match(src, /isDeleted: \{ \$ne: true \}/, file);
    assert.match(src, /status: \{ \$ne: [\"']archived[\"'] \}/, file);
  }
});

test('Parent child detail uses canonical Invoice and Payment with shared reconciliation truth', () => {
  const src = read('src/controllers/tenant/parents/childViewsController.js');
  assert.match(src, /const \{ Student, Attendance, Result, Payment, Invoice \}/);
  assert.doesNotMatch(src, /FeeInvoice|FeePayment|\bFee\b/);
  assert.match(src, /status: \{ \$ne: "Draft" \}/);
  assert.match(src, /accountSnapshot\(invoiceRows, paymentRows\)/);
  assert.match(src, /invoiceOutstanding/);
  assert.match(src, /unallocatedCredit/);
});
