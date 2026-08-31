const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('SchoolInquiry persists canonical tenant/status/lifecycle/audit fields', () => {
  const src = read('src/models/tenant/SchoolInquiry.js');
  for (const field of ['schoolCode','status','readAt','readBy','resolvedAt','resolvedBy','isDeleted','deletedAt','deletedBy']) {
    assert.match(src, new RegExp(`${field}:`), field);
  }
  assert.match(src, /enum:\s*\["new", "read", "resolved"\]/);
});

test('public inquiry submission fails closed and persists canonical school code/status when available', () => {
  const src = read('src/controllers/tenant/public/schoolProfilePublicController.js');
  assert.match(src, /Inquiry service is temporarily unavailable/);
  assert.match(src, /status:\s*"new"/);
  assert.match(src, /req\.tenant\?\.code \|\| code/);
  assert.doesNotMatch(src, /if \(!SchoolInquiry\)[\s\S]{0,180}ok:\s*true/);
});

test('Admin Inquiries route fails closed on SchoolInquiry model and exposes export/bulk', () => {
  const admin = read('src/routes/tenant/admin/index.js');
  const routes = read('src/routes/tenant/admin/inquiries.js');
  assert.match(admin, /requireTenantModels\(\["SchoolInquiry"\], \{ match: "all" \}\)/);
  assert.match(routes, /\/export\.csv/);
  assert.match(routes, /\/bulk/);
});

test('Admin Inquiries controller escapes search, soft-deletes and never downgrades resolved to read', () => {
  const src = read('src/controllers/tenant/admin/inquiriesController.js');
  assert.match(src, /buildInquiryFilter/);
  assert.match(src, /isDeleted:\s*true/);
  assert.doesNotMatch(src, /deleteOne\(|deleteMany\(/);
  const readAction = src.slice(src.indexOf('async markRead'), src.indexOf('async markResolved'));
  assert.doesNotMatch(readAction, /status:\s*"resolved"/);
  assert.match(readAction, /status:\s*"read"/);
  assert.match(src, /csvCell/);
});

test('Inquiries bulk actions are real and preserve CSRF form submission', () => {
  const js = read('public/js/admin-inquiries.js');
  assert.match(js, /submitPost\("\/admin\/inquiries\/bulk"/);
  assert.match(js, /bulk\("read"\)/);
  assert.match(js, /bulk\("resolve"\)/);
  assert.match(js, /bulk\("delete"\)/);
  assert.doesNotMatch(js, /Hook bulk|Hook export route|hook later/i);
  const view = read('views/tenant/inquiries/index.ejs');
  assert.match(view, /id="rowActionForm"/);
  assert.match(view, /name="_csrf"/);
});

test('Inquiries client renders database text through DOM textContent instead of innerHTML', () => {
  const js = read('public/js/admin-inquiries.js');
  assert.doesNotMatch(js, /innerHTML\s*=/);
  assert.match(js, /textContent/);
  assert.match(js, /replaceChildren/);
});

test('Inquiries JSON bootstrap is RCDATA-safe against textarea breakout', () => {
  const view = read('views/tenant/inquiries/index.ejs');
  assert.match(view, /replace\(\/<\/g, "\\\\u003c"\)/);
  assert.doesNotMatch(view, /<%-\s*JSON\.stringify\(inquiries \|\| \[\]\)\s*%>/);
});

test('Inquiry migration runs before index creation and standalone command exists', () => {
  const idx = read('scripts/create-indexes.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(idx, /migrateInquiries\(tenantModels, \{ schoolCode: tenant\.code \|\| tenant\.subdomain \}\)/);
  assert.equal(pkg.scripts['migrate:inquiries'], 'node scripts/migrate-inquiries.js');
  const migration = read('scripts/lib/migrateInquiries.js');
  assert.match(migration, /status = VALID_STATUSES\.has\(rawStatus\) \? rawStatus : "new"/);
  assert.match(migration, /schoolCodesBackfilled/);
});

test('changed Inquiries view compiles', () => {
  const file = 'views/tenant/inquiries/index.ejs';
  assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }));
});
