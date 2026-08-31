const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('canonical Library models are registered and use unique authoritative identifiers', () => {
  const loader = read('src/models/tenant/loadModels.js');
  for (const name of ['LibraryLoan','LibraryReservation','LibraryFine','LibraryHold']) assert.match(loader, new RegExp(name));
  for (const [file, field] of [['LibraryLoan.js','loanNo'],['LibraryReservation.js','reservationNo'],['LibraryFine.js','fineNo'],['LibraryHold.js','holdNo']]) {
    const src = read('src/models/tenant/'+file);
    assert.match(src, new RegExp(`${field}: 1`));
    assert.match(src, /unique:\s*true/);
  }
});

test('Admin Library routes expose real import/export/report/settings/bulk and canonical circulation actions', () => {
  const src = read('src/routes/tenant/admin/library.js');
  for (const route of ['/export.csv','/report.csv','/import','/bulk','/settings','/borrow','/fines','/holds']) assert.ok(src.includes(route), route);
});

test('Student Library routes expose real reserve and renew actions', () => {
  const src = read('src/routes/tenant/students/library.js');
  assert.match(src, /books\/:bookId\/reserve/);
  assert.match(src, /loans\/:loanId\/renew/);
});

test('Admin Library controller uses canonical standalone records and regex-escapes search', () => {
  const src = read('src/controllers/tenant/admin/libraryController.js');
  assert.match(src, /LibraryLoan\.find/);
  assert.match(src, /LibraryReservation\.find/);
  assert.match(src, /LibraryFine\.find/);
  assert.match(src, /LibraryHold\.find/);
  assert.match(src, /escapeRegex\(q\)/);
  assert.doesNotMatch(src, /book\.borrows\.unshift|book\.reservations\.unshift|book\.fines\.unshift|book\.holds\.unshift/);
  assert.doesNotMatch(src, /Math\.random/);
});

test('Library Admin client has no backend-later placeholders and wires approved controls to real routes', () => {
  const src = read('public/js/tenant-admin-library.js');
  assert.doesNotMatch(src, /backend route next|can be added next|wire a generic|Next step is wiring/i);
  assert.match(src, /\/admin\/library\/export\.csv/);
  assert.match(src, /\/admin\/library\/report\.csv/);
  assert.match(src, /libraryImportForm/);
  assert.match(src, /bulkLibraryForm/);
  assert.match(src, /librarySettingsForm/);
  assert.doesNotMatch(src, /innerHTML\s*=/);
});

test('Admin Library book JSON attributes are encoded instead of raw JSON', () => {
  const src = read('views/tenant/library/index.ejs');
  assert.match(src, /encodeURIComponent\(JSON\.stringify\(book\)\)/);
  assert.doesNotMatch(src, /data-book='<%-\s*JSON\.stringify/);
});

test('Student Library page has live search, reserve and renew forms with CSRF', () => {
  const src = read('views/students/library.ejs');
  assert.match(src, /method="GET" action="\/student\/library"/);
  assert.match(src, /\/student\/library\/books\/<%= book\.id %>\/reserve/);
  assert.match(src, /\/student\/library\/loans\/<%= loan\.id %>\/renew/);
  assert.match(src, /name="_csrf"/);
  assert.doesNotMatch(src, /Search" disabled|type="button" disabled/);
});

test('Library migration runs before tenant indexes and has standalone command', () => {
  const idx = read('scripts/create-indexes.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(idx, /migrateLibrary\(tenantModels\)/);
  assert.equal(pkg.scripts['migrate:library'], 'node scripts/migrate-library.js');
  const migration = read('scripts/lib/migrateLibrary.js');
  assert.match(migration, /migrateEmbedded/);
  assert.match(migration, /repairBookIds/);
  assert.match(migration, /syncInventory/);
});

test('Library models keep embedded arrays only as legacy migration input while controllers ignore them', () => {
  const model = read('src/models/tenant/LibraryBook.js');
  const migration = read('scripts/lib/migrateLibrary.js');
  const controller = read('src/controllers/tenant/admin/libraryController.js');
  assert.match(model, /borrows:\s*\[borrowSchema\]/);
  assert.match(migration, /book\.borrows/);
  assert.doesNotMatch(controller, /\.borrows|\.reservations|\.fines|\.holds/);
});

test('changed Library views compile', () => {
  for (const file of ['views/students/library.ejs','views/tenant/library/index.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});

test('Library access fails closed on the complete canonical model set in both Admin and Student portals', () => {
  const admin = read('src/routes/tenant/admin/index.js');
  const student = read('src/routes/tenant/students/index.js');
  assert.match(admin, /\["LibraryBook", "LibraryLoan", "LibraryReservation", "LibraryFine", "LibraryHold"\], \{ match: "all" \}/);
  assert.match(student, /\["LibraryBook", "LibraryLoan", "LibraryReservation", "LibraryFine", "LibraryHold"\], \{ match: "all" \}/);
});

test('Hostel canonical model guards remain fail-closed while Library work is added', () => {
  const admin = read('src/routes/tenant/admin/index.js');
  const student = read('src/routes/tenant/students/index.js');
  assert.match(admin, /\["Hostel", "HostelAllocation", "HostelApplication"\], \{ match: "all" \}/);
  assert.match(student, /\["Hostel", "HostelAllocation", "HostelApplication"\], \{ match: "all" \}/);
});

test('Student navigation remains fail-closed for recovered Helpdesk, Events, Hostels and Library modules', () => {
  for (const file of ['views/students/navbar.ejs','views/students/dashboard.ejs']) {
    const src = read(file);
    assert.match(src, /featureFlags\?\.helpdesk === true/);
    assert.match(src, /hasAllModels\("Hostel", "HostelAllocation", "HostelApplication"\)/);
    assert.match(src, /hasAllModels\("LibraryBook", "LibraryLoan", "LibraryReservation", "LibraryFine", "LibraryHold"\)/);
    assert.match(src, /hasAllModels\("Event", "EventRegistration", "EventSubscription", "EventView"\)/);
  }
});
