const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Admin Results fail closed on the complete canonical academic model set', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.match(src, /\/results"[\s\S]*requireTenantModels\(\["Result", "Exam", "Student", "Class", "Section", "Stream", "Subject"\], \{ match: "all" \}\)/);
});

test('Student and Parent Results fail closed on Student, Result, Exam and Subject together', () => {
  const student = read('src/routes/tenant/students/index.js');
  const parent = read('src/routes/tenant/parents/index.js');
  assert.match(student, /requireTenantModels\(\["Student", "Result", "Exam", "Subject"\], \{ match: "all" \}\)[\s\S]*require\("\.\/results"\)/);
  assert.match(parent, /requireTenantModels\(\["Student", "Result", "Exam", "Subject"\], \{ match: "all" \}\)[\s\S]*require\("\.\/results"\)/);
});

test('Student and Parent result readers use canonical published-only Result.student visibility', () => {
  for (const rel of ['src/controllers/tenant/students/resultsController.js','src/controllers/tenant/parents/resultsController.js']) {
    const src = read(rel);
    assert.match(src, /studentPublishedResultFilter/);
    assert.doesNotMatch(src, /Result\.find\(\{\s*studentId/);
    assert.doesNotMatch(src, /semester:/);
  }
});

test('Student dashboard does not leak draft or quarantined results', () => {
  const src = read('src/controllers/tenant/students/dashboardController.js');
  assert.match(src, /Result\.find\(studentPublishedResultFilter\(student\._id\)\)/);
});

test('Student transcript consumes canonical published results instead of legacy studentId result rows', () => {
  const src = read('src/controllers/tenant/students/transcriptController.js');
  assert.match(src, /Result\.find\(studentPublishedResultFilter\(student\._id\)\)/);
  assert.match(src, /populate\(\{ path: "subject"/);
  assert.match(src, /Transcript\.findOne\(\{ student: student\._id, status: "issued" \}\)/);
  assert.doesNotMatch(src, /Result\.find\(\{ studentId/);
});

test('Admin result mutations share lifecycle guards and do not blind bulk-update/delete business rows', () => {
  const src = read('src/controllers/tenant/admin/resultsController.js');
  for (const token of ['buildResultValues','assertResultEditable','assertIdentityChangeAllowed','assertDeleteAllowed','resultStatusUpdate','applyBulkWithCompensation']) {
    assert.ok(src.includes(token), token);
  }
  assert.doesNotMatch(src, /Result\.updateMany\(/);
  assert.match(src, /Result\.bulkWrite\(/);
});

test('Results import and bulk routes are declared before generic :id route', () => {
  const src = read('src/routes/tenant/admin/results.js');
  const generic = src.indexOf('router.post("/:id"');
  assert.ok(src.indexOf('router.post("/import"') < generic);
  assert.ok(src.indexOf('router.post("/bulk"') < generic);
});

test('Results import validates the whole CSV before writing and has compensation/transaction support', () => {
  const src = read('src/controllers/tenant/admin/resultsController.js');
  assert.match(src, /Import rejected before writing/);
  assert.match(src, /withTransaction/);
  assert.match(src, /insertPreparedWithCompensation/);
  assert.match(src, /duplicate examId\/studentId pair in this CSV/);
  assert.match(src, /3,000 result rows/);
});

test('Result JSON bootstraps are RCDATA escaped', () => {
  const src = read('views/tenant/results/index.ejs');
  const blocks = [...src.matchAll(/<textarea[^>]+class="json-data"[\s\S]*?<%-([\s\S]*?)%><\/textarea>/g)];
  assert.ok(blocks.length >= 5);
  for (const m of blocks) assert.match(m[1], /replace\(\/<\/g, "\\\\u003c"\)/);
});

test('Result client renders database values through DOM text APIs rather than innerHTML', () => {
  const src = read('public/js/results.js');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.doesNotMatch(src, /insertAdjacentHTML/);
  assert.match(src, /textContent/);
  assert.match(src, /replaceChildren/);
  assert.doesNotMatch(src, /save anyway/i);
});

test('Result model keeps publication audit, quarantine state and partial active uniqueness', () => {
  const src = read('src/models/tenant/Result.js');
  for (const token of ['firstPublishedAt','publishedAt','publishedBy','reopenedAt','reopenedBy','revision','migrationQuarantinedAt','passMark']) assert.ok(src.includes(token), token);
  assert.match(src, /name: "uniq_active_result_exam_student"/);
  assert.match(src, /partialFilterExpression: \{ migrationQuarantinedAt: null \}/);
});

test('Result migration is exposed and runs before tenant indexes', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['migrate:results'], 'node scripts/migrate-results.js');
  const src = read('scripts/create-indexes.js');
  const migration = src.indexOf('migrateResults(tenantModels)');
  const indexes = src.indexOf('createModelIndexes(label, tenantModels)');
  assert.ok(migration >= 0 && indexes > migration);
});

test('Result migration normalizes legacy identity/status/marks, quarantines unresolved and duplicates, and repairs index shape', () => {
  const src = read('scripts/lib/migrateResults.js');
  for (const token of ['resolveRecord','normalizeStatus','extractLegacyScore','studentId','examId','duplicatesQuarantined','dropConflictingResultIndexes','ensureResultIndex']) assert.ok(src.includes(token), token);
});

test('Admin, Student and Parent Results templates compile', () => {
  for (const rel of ['views/tenant/results/index.ejs','views/students/results.ejs','views/parents/results.ejs']) {
    const file = path.join(root, rel);
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }), rel);
  }
});

test('Parent child detail cannot bypass the published-only Result contract', () => {
  const src = read('src/controllers/tenant/parents/childViewsController.js');
  assert.match(src, /Result\.find\(studentPublishedResultFilter\(student\._id\)\)/);
  assert.doesNotMatch(src, /Result\.find\([\s\S]{0,180}studentId/);
  assert.match(src, /populate\(\{ path: "exam"/);
  assert.match(src, /populate\(\{ path: "subject"/);
});
