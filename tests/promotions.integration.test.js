const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Student model exposes reclaimable promotion lease fields', () => {
  const src = read('src/models/tenant/Student.js');
  assert.match(src, /promotionLeaseToken/);
  assert.match(src, /promotionLeaseExpiresAt/);
  assert.match(src, /promotionLeaseBy/);
});

test('PromotionLog records batch and canonical action provenance', () => {
  const src = read('src/models/tenant/PromotionLog.js');
  assert.match(src, /batchId/);
  assert.match(src, /advanced_term/);
  assert.match(src, /repeated/);
  assert.match(src, /graduated/);
  assert.match(src, /PromotionLogSchema\.index\(\{ batchId: 1, student: 1 \}\)/);
});

test('Admin Promotions controller delegates mutations to batch service instead of direct status writes', () => {
  const src = read('src/controllers/tenant/admin/promotionsController.js');
  assert.match(src, /applyPromotionBatch\(req/);
  assert.doesNotMatch(src, /Student\.updateMany\([^;]+status/);
  assert.doesNotMatch(src, /student\.status\s*=/);
});

test('Admin Promotions routes expose real history export', () => {
  const src = read('src/routes/tenant/admin/promotions.js');
  assert.match(src, /router\.get\("\/export", ctrl\.exportCsv\)/);
  assert.match(src, /router\.post\("\/apply", ctrl\.applyBulk\)/);
});

test('approved Promotions page restricts actions to Active/Graduated contract', () => {
  const src = read('views/tenant/promotions/index.ejs');
  assert.match(src, /Only Active students can be promoted/);
  assert.match(src, /Graduated \(S6 only\)/);
  assert.match(src, /\/admin\/promotions\/export/);
  const targetBlock = src.slice(src.indexOf('id="toStatus"'), src.indexOf('id="toClassId"'));
  assert.doesNotMatch(targetBlock, /On Hold|Suspended/);
});

test('Promotions client is CSP-safe and graduation removes destination-class requirement', () => {
  const src = read('public/js/promotions.js');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(src, /rowChk:not\(:disabled\)/);
  assert.match(src, /statusSelect\.value === "graduated"/);
  assert.match(src, /classSelect\.required = !graduating/);
});

test('batch service validates capacity before mutations and compensates failed batches', () => {
  const src = read('src/services/tenant/promotionService.js');
  assert.match(src, /Destination class capacity would be exceeded/);
  assert.match(src, /PromotionLog\.deleteMany\(\{ batchId \}\)/);
  assert.match(src, /for \(const student of \[\.\.\.changed\]\.reverse\(\)\)/);
  assert.match(src, /applyStudentLifecycle\(req, student, before\.status/);
  assert.match(src, /finally \{[\s\S]*releaseBatch/);
});

test('promotion migration runs before index synchronization and has a CLI entry', () => {
  const idx = read('scripts/create-indexes.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(idx, /migratePromotions\(tenantModels\)/);
  assert.ok(idx.indexOf('migratePromotions(tenantModels)') < idx.indexOf('createModelIndexes(label, tenantModels)'));
  assert.equal(pkg.scripts['migrate:promotions'], 'node scripts/migrate-promotions.js');
  assert.ok(fs.existsSync(path.join(root, 'scripts/lib/migratePromotions.js')));
});

test('Promotions EJS compiles', () => {
  assert.doesNotThrow(() => ejs.compile(read('views/tenant/promotions/index.ejs'), { filename: path.join(root, 'views/tenant/promotions/index.ejs') }));
});
