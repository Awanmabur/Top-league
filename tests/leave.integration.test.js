const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin Leave mount uses canonical staff permission and complete model guard', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.match(src, /"\/staff-leave", requireTenantPermission\("staff\.view"\), requireTenantModels\(\["Staff", "LeaveRequest"\]/);
});

test('staff Leave route is model-guarded and supports owned cancellation', () => {
  const index = read('src/routes/tenant/staff/index.js');
  const routes = read('src/routes/tenant/staff/leave.js');
  assert.match(index, /requireTenantModels\(\["Staff", "LeaveRequest"\], \{ match: "all" \}\), require\("\.\/leave"\)/);
  assert.match(routes, /\/leave\/:id\/cancel/);
});

test('staff Leave controller uses canonical fields and statuses instead of from/to lowercase pending', () => {
  const src = read('src/controllers/tenant/staff/leaveController.js');
  assert.match(src, /startDate: req\.body\.startDate/);
  assert.match(src, /endDate: req\.body\.endDate/);
  assert.doesNotMatch(src, /status:\s*["']pending["']/);
  assert.doesNotMatch(src, /\bfrom,\s*\n\s*to\b/);
});

test('shared Leave service centralizes lifecycle, overlap lock and date status sync', () => {
  const src = read('src/services/tenant/leaveService.js');
  for (const marker of ['withStaffLeaveLock', 'assertNoOverlap', "status: 'Pending'", "status: 'Approved'", 'refreshStaffLeaveStatus', "['Suspended', 'Exited']"]) assert.ok(src.includes(marker), marker);
  assert.match(src, /Only a pending leave request can be approved/);
  assert.match(src, /Only rejected or cancelled leave requests can be deleted/);
});

test('admin bulk Leave actions reuse single lifecycle services rather than updateMany bypass', () => {
  const src = read('src/controllers/tenant/admin/leaveController.js');
  assert.match(src, /approveLeave\(req\.models/);
  assert.match(src, /rejectLeave\(req\.models/);
  assert.match(src, /cancelLeave\(req\.models/);
  assert.match(src, /deleteLeave\(req\.models/);
  assert.doesNotMatch(src, /LeaveRequest\.updateMany/);
});

test('admin Leave bootstrap is RCDATA-safe and client avoids database-backed innerHTML', () => {
  const view = read('views/tenant/staff/leave.ejs');
  const js = read('public/js/staff-leave.js');
  assert.match(view, /\\u0026/); assert.match(view, /\\u003c/); assert.match(view, /\\u003e/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /replaceChildren/);
});

test('staff Leave form has CSRF, leave type, canonical dates and cancellation form', () => {
  const view = read('views/staff/leave.ejs');
  assert.match(view, /name="_csrf"/);
  assert.match(view, /name="leaveType"/);
  assert.match(view, /name="startDate"/);
  assert.match(view, /name="endDate"/);
  assert.match(view, /\/staff\/leave\/<%= item\._id %>\/cancel/);
  assert.doesNotMatch(view, /name="from"|name="to"/);
});

test('leave scheduler is bootstrapped and shutdown cleanly', () => {
  const index = read('src/index.js');
  const scheduler = read('src/services/tenant/leaveScheduler.js');
  assert.match(index, /startLeaveScheduler\(\)/);
  assert.match(index, /stopLeaveScheduler\(\)/);
  assert.match(scheduler, /processLeaveStatuses/);
  assert.match(scheduler, /DISABLE_LEAVE_SCHEDULER/);
});

test('leave migration runs before index creation and has an explicit package command', () => {
  const indexes = read('scripts/create-indexes.js');
  const migration = read('scripts/lib/migrateLeaveRequests.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(indexes, /migrateLeaveRequests\(tenantModels/);
  assert.match(migration, /row\.startDate \|\| row\.from/);
  assert.match(migration, /normalizeStatus/);
  assert.equal(pkg.scripts['migrate:leave'], 'node scripts/migrate-leave.js');
});

test('Staff model contains an internal expiring leave operation lease', () => {
  const src = read('src/models/tenant/Staff.js');
  assert.match(src, /leaveOps/); assert.match(src, /lockToken/); assert.match(src, /lockUntil/);
});

test('active Leave EJS templates compile', () => {
  for (const file of ['views/tenant/staff/leave.ejs', 'views/staff/leave.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});
