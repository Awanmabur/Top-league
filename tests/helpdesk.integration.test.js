const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const requesterControllers = [
  'src/controllers/tenant/students/supportController.js',
  'src/controllers/tenant/parents/supportController.js',
  'src/controllers/tenant/staff/supportController.js',
];

test('all requester controllers use canonical HelpdeskTicket ownership and no legacy ticket model/fields', () => {
  for (const file of requesterControllers) {
    const src = read(file);
    assert.match(src, /HelpdeskTicket/);
    assert.match(src, /requesterUserId/);
    assert.doesNotMatch(src, /SupportTicket/);
    assert.doesNotMatch(src, /createdByUserId/);
  }
});

test('student, parent and staff support routes expose create/reply and are feature/model gated', () => {
  const studentRoutes = read('src/routes/tenant/students/support.js');
  const parentRoutes = read('src/routes/tenant/parents/support.js');
  const staffRoutes = read('src/routes/tenant/staff/support.js');
  assert.match(studentRoutes, /post\("\/support"/);
  assert.match(studentRoutes, /post\("\/support\/:id\/reply"/);
  assert.match(parentRoutes, /post\("\/support\/:id\/reply"/);
  assert.match(staffRoutes, /post\("\/support"/);
  assert.match(staffRoutes, /post\("\/support\/:id\/reply"/);

  for (const file of [
    'src/routes/tenant/students/index.js',
    'src/routes/tenant/parents/index.js',
    'src/routes/tenant/staff/index.js',
  ]) {
    const src = read(file);
    assert.match(src, /helpdesk/);
    assert.match(src, /HelpdeskTicket/);
  }
});

test('portal navigation visibility uses HelpdeskTicket rather than nonexistent models', () => {
  for (const file of [
    'views/students/navbar.ejs',
    'views/students/dashboard.ejs',
    'views/parents/navbar.ejs',
    'views/parents/dashboard.ejs',
    'views/parents/profile.ejs',
    'views/staff/navbar.ejs',
    'views/staff/dashboard.ejs',
  ]) {
    const src = read(file);
    assert.match(src, /HelpdeskTicket/);
    assert.doesNotMatch(src, /SupportTicket/);
  }
});

test('student support detail rendering avoids dynamic innerHTML and form posts real ticket data', () => {
  const src = read('views/students/support.ejs');
  assert.match(src, /action="\/student\/support"/);
  assert.match(src, /name="subject"/);
  assert.match(src, /name="description"/);
  assert.match(src, /name="priority"/);
  assert.match(src, /textContent/);
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
});

test('admin Helpdesk routes implement export, templates, reply, lifecycle and bulk actions', () => {
  const src = read('src/routes/tenant/admin/helpdesk.js');
  for (const route of ['/export', '/templates', '/bulk', '/:id/update', '/:id/reply', '/:id/progress', '/:id/resolve', '/:id/close']) {
    assert.ok(src.includes(route), `missing admin Helpdesk route ${route}`);
  }
  assert.ok(fs.existsSync(path.join(root, 'public/js/helpdesk.js')));
  assert.ok(fs.existsSync(path.join(root, 'views/tenant/helpdesk/templates.ejs')));
});

test('HelpdeskTicket has a unique ticket number index and HelpdeskTemplate is registered', () => {
  const ticketModel = read('src/models/tenant/HelpdeskTicket.js');
  const loader = read('src/models/tenant/loadModels.js');
  assert.match(ticketModel, /ticketNo:\s*1/);
  assert.match(ticketModel, /unique:\s*true/);
  assert.match(loader, /HelpdeskTicket/);
  assert.match(loader, /HelpdeskTemplate/);
});

test('plan access is explicit and fail-closed, and seeded plans declare helpdesk flag', () => {
  const access = read('src/utils/tenantPlanAccess.js');
  const plan = read('src/models/platform/Plan.js');
  const seed = read('scripts/seedPlatformPlans.js');
  assert.match(access, /flags\.helpdesk\s*===\s*true/);
  assert.match(plan, /helpdesk:\s*\{\s*type:\s*Boolean,\s*default:\s*false\s*\}/);
  const explicitFlags = seed.match(/helpdesk:\s*(?:true|false)/g) || [];
  assert.ok(explicitFlags.length >= 5, `expected at least five explicit seeded helpdesk flags, found ${explicitFlags.length}`);
});

test('all changed Helpdesk EJS views compile', () => {
  for (const file of [
    'views/students/support.ejs',
    'views/parents/support.ejs',
    'views/staff/support.ejs',
    'views/tenant/helpdesk/index.ejs',
    'views/tenant/helpdesk/templates.ejs',
    'views/platform/plans/create.ejs',
    'views/platform/plans/edit.ejs',
  ]) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});

test('index creation repairs legacy Helpdesk data before enforcing the unique ticket number index', () => {
  const createIndexes = read('scripts/create-indexes.js');
  const migration = read('scripts/lib/migrateHelpdeskTickets.js');
  assert.match(createIndexes, /migrateHelpdeskTickets\(tenantModels\.HelpdeskTicket\)/);
  assert.match(migration, /dropIndex/);
  assert.match(migration, /createIndex\(\{ ticketNo: 1 \}, \{ unique: true \}\)/);
});
