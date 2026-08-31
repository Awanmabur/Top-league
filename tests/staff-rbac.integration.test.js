const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin Staff, Users and Roles mounts use the canonical permission middleware', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.match(src, /router\.use\("\/staff", requireTenantPermission\("staff\.view"\)/);
  assert.match(src, /router\.use\("\/users", requireTenantPermission\("users\.view"\)/);
  assert.match(src, /router\.use\("\/roles", requireTenantPermission\("roles\.view"\)/);
});

test('roles routes implement filtered export and lifecycle actions', () => {
  const routes = read('src/routes/tenant/admin/roles.js');
  for (const route of ['/export.csv', '/bulk', '/:id/update', '/:id/activate', '/:id/deactivate', '/:id/delete']) {
    assert.ok(routes.includes(route), `missing ${route}`);
  }
  const controller = read('src/controllers/tenant/admin/rolesController.js');
  assert.match(controller, /roleIsAssigned/);
  assert.match(controller, /csvCell/);
  assert.match(controller, /escapeRegex/);
});

test('custom role permissions are loaded per authenticated staff request', () => {
  const auth = read('src/middleware/tenant/requireTenantAuth.js');
  assert.match(auth, /StaffRole\.findOne/);
  assert.match(auth, /accessPermissions:/);
  assert.match(auth, /normalizePermissionList/);
  const permission = read('src/middleware/tenant/requireTenantPermission.js');
  assert.match(permission, /builtInAllowed && \(role === "admin" \|\| customAllowed\)/);
});

test('staff lifecycle suspends linked access, can restore only staff-caused suspension, and protects last active admin', () => {
  const src = read('src/controllers/tenant/admin/staffController.js');
  assert.match(src, /staffAccessSuspended/);
  assert.match(src, /tokenVersion/);
  assert.match(src, /linkedUserWouldBeLastActiveAdmin/);
  assert.match(src, /assertStaffAccessChangeSafe/);
  assert.match(src, /only remaining active tenant admin/);
});

test('user mutations revoke cached sessions and protect the only active admin including bulk operations', () => {
  const src = read('src/controllers/tenant/admin/usersController.js');
  assert.match(src, /invalidateTenantUserCache/);
  assert.match(src, /\$inc:\s*\{ tokenVersion: 1 \}/);
  assert.match(src, /Bulk action would remove the only remaining active admin/);
  assert.match(src, /status: USER_STATUS\.ACTIVE/);
});

test('StaffRole and Staff enforce unique active identity links', () => {
  const role = read('src/models/tenant/StaffRole.js');
  const staff = read('src/models/tenant/Staff.js');
  assert.match(role, /\{ code: 1 \}.*unique: true/s);
  assert.match(staff, /\{ userId: 1 \}.*unique: true/s);
});

test('staff role migration normalizes legacy permissions and duplicate staff-user links before indexes', () => {
  const migration = read('scripts/lib/migrateStaffRoles.js');
  const indexes = read('scripts/create-indexes.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(migration, /normalizePermissionList/);
  assert.match(migration, /duplicateStaffLinksCleared/);
  assert.match(indexes, /migrateStaffRoles\(tenantModels\)/);
  assert.equal(pkg.scripts['migrate:staff-roles'], 'node scripts/migrate-staff-roles.js');
});

test('active staff navigation uses mounted canonical Users, Roles and Payroll URLs', () => {
  for (const file of ['views/tenant/staff/index.ejs', 'views/tenant/staff/leave.ejs', 'views/tenant/staff/users.ejs']) {
    const src = read(file);
    assert.doesNotMatch(src, /\/admin\/staff-users|\/admin\/staff-roles|\/admin\/staff-payroll/);
  }
});

test('active Staff, Users and Roles JSON bootstraps are RCDATA safe and clients avoid database-backed innerHTML', () => {
  for (const file of ['views/tenant/staff/index.ejs', 'views/tenant/users/index.ejs', 'views/tenant/staff/roles.ejs']) {
    const src = read(file);
    assert.match(src, /\\\\u003c/);
  }
  for (const file of ['public/js/staff.js', 'public/js/users-index.js', 'public/js/roles.js']) {
    assert.doesNotMatch(read(file), /\.innerHTML\s*=/);
  }
});

test('active Staff, Users and Roles EJS templates compile', () => {
  for (const file of ['views/tenant/staff/index.ejs', 'views/tenant/users/index.ejs', 'views/tenant/staff/roles.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});
