const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('FeeStructure is a standalone canonical model instead of an alias to legacy Fees', () => {
  const loader = read('src/models/tenant/loadModels.js');
  const model = read('src/models/tenant/FeeStructure.js');
  assert.match(loader, /FeeStructure:\s*defineModel\("FeeStructure"\)/);
  assert.doesNotMatch(loader, /FeeStructure:\s*defineModel\("Fees"\)/);
  assert.match(model, /conn\.model\("FeeStructure"/);
  assert.match(model, /structureCode/);
  assert.doesNotMatch(model, /amountPaid/);
});

test('Fee Structure routes use the canonical controller and expose real export/lifecycle actions', () => {
  const routes = read('src/routes/tenant/admin/feeStructures.js');
  assert.match(routes, /feeStructuresController/);
  for (const route of ['/export.csv', '/bulk', '/:id/update', '/:id/activate', '/:id/inactive', '/:id/archive', '/:id/delete']) {
    assert.ok(routes.includes(route), `missing ${route}`);
  }
  assert.doesNotMatch(routes, /bulk-generate|issue|voidFee/);
});

test('Fee Structure live route fails closed on the real FeeStructure model', () => {
  const admin = read('src/routes/tenant/admin/index.js');
  assert.match(admin, /\/fee-structures"[^\n]+requireTenantModels\(\["FeeStructure"\]/);
  assert.match(admin, /\/fees"[^\n]+requireTenantModels\(\["FeeStructure"\]/);
});

test('approved Fee Structure page is now the rendered live view with safe JSON bootstrap', () => {
  const controller = read('src/controllers/tenant/admin/feeStructuresController.js');
  const view = read('views/tenant/finance/fee-structures.ejs');
  assert.match(controller, /res\.render\("tenant\/finance\/fee-structures"/);
  assert.match(view, /JSON\.stringify\(feeStructures \|\| \[\]\)\.replace\(\/<\/g/);
  assert.match(view, /\/js\/fee-structures\.js/);
  assert.ok(fs.existsSync(path.join(root, 'public/js/fee-structures.js')));
});

test('Fee Structure client uses safe DOM rendering and real Export/Bulk/Invoice-template controls', () => {
  const js = read('public/js/fee-structures.js');
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /\/admin\/fee-structures\/export\.csv/);
  assert.match(js, /bulkSubmit\("activate"\)/);
  assert.match(js, /bulkSubmit\("archive"\)/);
  assert.match(js, /\/admin\/invoices\?structure=/);
  assert.doesNotMatch(js, /hook later|backend later|UI-only/i);
});

test('Fee Structure controller never accepts amountPaid or maintains a parallel paid balance', () => {
  const controller = read('src/controllers/tenant/admin/feeStructuresController.js');
  const service = read('src/services/tenant/feeStructureService.js');
  assert.doesNotMatch(controller, /amountPaid|balance\s*:/);
  assert.doesNotMatch(service, /amountPaid|paidAmount/);
});

test('legacy Fee migration preserves paid claims as Pending reconciliation rather than verified collections', () => {
  const migration = read('scripts/lib/migrateFeeStructures.js');
  assert.match(migration, /LEGACY-FEE:/);
  assert.match(migration, /LEGACY-FEE-PAID-CLAIM:/);
  assert.match(migration, /status:\s*"Pending"/);
  assert.match(migration, /not counted as received until explicitly completed/i);
});

test('Fee Structure migration runs before Finance migration and index creation', () => {
  const indexes = read('scripts/create-indexes.js');
  const feePos = indexes.indexOf('migrateFeeStructures(tenantModels)');
  const financePos = indexes.indexOf('migrateFinance(tenantModels)');
  const indexPos = indexes.indexOf('createModelIndexes(label, tenantModels)');
  assert.ok(feePos >= 0 && financePos > feePos && indexPos > financePos);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['migrate:fee-structures'], 'node scripts/migrate-fee-structures.js');
});

test('Invoice retains fee structure provenance while storing its own line-item snapshot', () => {
  const model = read('src/models/tenant/Invoice.js');
  const controller = read('src/controllers/tenant/admin/invoicesController.js');
  const client = read('public/js/invoices.js');
  const view = read('views/tenant/finance/invoices.ejs');
  assert.match(model, /feeStructureId:[\s\S]*ref:\s*"FeeStructure"/);
  assert.match(controller, /status:\s*"Active"[\s\S]*feeStructureId/);
  assert.match(controller, /Selected fee structure is not active or no longer available/);
  assert.match(client, /invoiceTemplateData/);
  assert.match(client, /iFeeStructure/);
  assert.match(view, /name="feeStructureId"/);
  assert.match(view, /invoiceTemplateData/);
});

test('Fee Structure and Invoice live EJS views compile', () => {
  for (const file of ['views/tenant/finance/fee-structures.ejs', 'views/tenant/finance/invoices.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }), file);
  }
});

test('navbar points directly at the canonical Fee Structure screen', () => {
  const nav = read('views/tenant/partials/navbar.ejs');
  assert.match(nav, /label:\s*"Fee Structure"[^\n]+href:\s*"\/admin\/fee-structures"/);
});
