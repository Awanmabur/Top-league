const test = require('node:test');
const assert = require('node:assert/strict');

const requireTenantPermission = require('../src/middleware/tenant/requireTenantPermission');
const {
  normalizeRoleCode,
  normalizePermission,
  normalizePermissionList,
  parsePermissionForm,
  csvCell,
} = require('../src/services/tenant/roleService');

function runGuard(permission, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ allowed: false, status: this.statusCode, body }); },
      redirect(url) { resolve({ allowed: false, status: this.statusCode, redirect: url }); },
    };
    req.flash = () => {};
    requireTenantPermission(permission)(req, res, () => resolve({ allowed: true, status: 200 }));
  });
}

test('role codes and permissions normalize to canonical bounded values', () => {
  assert.equal(normalizeRoleCode('  Finance / Clerk  '), 'FINANCE_CLERK');
  assert.equal(normalizePermission('finance'), 'finance.manage');
  assert.equal(normalizePermission('finance.manage'), 'finance.manage');
  assert.equal(normalizePermission('definitely.not.real'), null);
  assert.deepEqual(normalizePermissionList(['finance', 'finance.manage', 'reports', 'bad']), ['finance.manage', 'reports.view']);
});

test('permission form accepts only explicit catalog checkboxes', () => {
  const permissions = parsePermissionForm({ perm_finance: 'on', perm_reports: 'true', perm_students: '0', arbitrary: 'on' });
  assert.deepEqual(permissions, ['finance.manage', 'reports.view']);
});

test('CSV export neutralizes spreadsheet formulas', () => {
  assert.match(csvCell('=HYPERLINK("x")'), /^"'/);
  assert.match(csvCell('+cmd'), /^"'/);
  assert.equal(csvCell('Normal'), '"Normal"');
});

test('custom role can restrict but never expand built-in tenant permissions', async () => {
  const allowed = await runGuard('finance.view', { method: 'GET', headers: { accept: 'application/json' }, user: { role: 'finance', accessPermissions: ['finance.manage'] } });
  assert.equal(allowed.allowed, true);

  const restricted = await runGuard('finance.view', { method: 'GET', headers: { accept: 'application/json' }, user: { role: 'finance', accessPermissions: [] } });
  assert.equal(restricted.allowed, false);
  assert.equal(restricted.status, 403);

  const cannotExpand = await runGuard('students.view', { method: 'GET', headers: { accept: 'application/json' }, user: { role: 'finance', accessPermissions: ['students.manage'] } });
  assert.equal(cannotExpand.allowed, false);
  assert.equal(cannotExpand.status, 403);
});

test('custom role view permission cannot mutate a manage-split module', async () => {
  const read = await runGuard('finance.view', { method: 'GET', headers: { accept: 'application/json' }, user: { role: 'finance', accessPermissions: ['finance.manage'] } });
  assert.equal(read.allowed, true);

  const write = await runGuard('finance.view', { method: 'POST', headers: { accept: 'application/json' }, user: { role: 'finance', accessPermissions: ['reports.view'] } });
  assert.equal(write.allowed, false);
  assert.equal(write.status, 403);
});

test('tenant admin wildcard is never reduced by a staff custom role', async () => {
  const result = await runGuard('settings.manage', { method: 'POST', headers: { accept: 'application/json' }, user: { role: 'admin', accessPermissions: [] } });
  assert.equal(result.allowed, true);
});
