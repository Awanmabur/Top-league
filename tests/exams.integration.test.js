const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Admin Exams fail closed on the complete lifecycle and notification model set', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.match(src, /\/exams"[\s\S]*requireTenantModels\(\["Exam", "Result", "Class", "Section", "Stream", "Subject", "Staff", "Student", "Notification"\], \{ match: "all" \}\)/);
});

test('Student Exams fail closed on canonical exam/student/class/subject models', () => {
  const src = read('src/routes/tenant/students/index.js');
  assert.match(src, /requireTenantModels\(\["Exam", "Student", "Class", "Subject"\], \{ match: "all" \}\)[\s\S]*require\("\.\/exams"\)/);
});

test('Student Exams use canonical classGroup/subject schema and only visible statuses', () => {
  const src = read('src/controllers/tenant/students/examsController.js');
  assert.match(src, /classGroup: student\.classId/);
  assert.match(src, /status: \{ \$in: \["scheduled", "completed"\] \}/);
  assert.match(src, /exam\.subject\?\.code/);
  for (const legacy of ['courseCode', 'courseTitle', 'programId', 'studentId', 'venue']) {
    assert.equal(src.includes(legacy), false, `legacy Student exam field remains: ${legacy}`);
  }
});

test('Admin Exam mutations share lifecycle guards and avoid blind Exam updateMany/deleteMany', () => {
  const src = read('src/controllers/tenant/admin/examsController.js');
  for (const token of ['assertStatusTransition', 'assertEditAllowed', 'assertHardDeleteAllowed', 'countExamResults', 'notifyTargetStudents']) assert.ok(src.includes(token), token);
  assert.doesNotMatch(src, /Exam\.updateMany\(/);
  assert.doesNotMatch(src, /Exam\.deleteMany\(/);
  assert.match(src, /Exam\.bulkWrite\(/);
});

test('Exam bulk route is declared before generic :id update route', () => {
  const src = read('src/routes/tenant/admin/exams.js');
  assert.ok(src.indexOf('router.post("/bulk"') < src.indexOf('router.post("/:id"'));
});

test('Exam JSON bootstraps are RCDATA escaped', () => {
  const src = read('views/tenant/exams/index.ejs');
  const blocks = [...src.matchAll(/<textarea[^>]+class="json-data"[\s\S]*?<%-([\s\S]*?)%><\/textarea>/g)];
  assert.ok(blocks.length >= 5);
  for (const m of blocks) assert.match(m[1], /replace\(\/<\/g, "\\\\u003c"\)/);
});

test('Exam client renders database values with DOM text APIs rather than innerHTML', () => {
  const src = read('public/js/exams.js');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(src, /textContent/);
  assert.match(src, /replaceChildren/);
});

test('Exam migration is exposed and runs before tenant index synchronization', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['migrate:exams'], 'node scripts/migrate-exams.js');
  const src = read('scripts/create-indexes.js');
  const migration = src.indexOf('migrateExams(tenantModels)');
  const indexes = src.indexOf('createModelIndexes(label, tenantModels)');
  assert.ok(migration >= 0 && indexes > migration);
});

test('Exam migration normalizes legacy fields, quarantines unresolved/duplicates, and repairs index shape', () => {
  const src = read('scripts/lib/migrateExams.js');
  for (const token of ['normalizeExamType', 'normalizeStatus', 'courseCode', 'courseTitle', 'archivedUnresolved', 'duplicatesArchived', 'dropConflictingExamIndexes', 'ensureExamIndex']) {
    assert.ok(src.includes(token), token);
  }
});

test('Exam unique schedule index excludes archived rows through archivedAt lifecycle state', () => {
  const src = read('src/models/tenant/Exam.js');
  assert.match(src, /name: "uniq_active_exam_scope_schedule"/);
  assert.match(src, /partialFilterExpression: \{ archivedAt: null \}/);
  assert.match(src, /publishedAt/);
  assert.match(src, /completedAt/);
  assert.match(src, /archivedAt/);
});

test('Exam schedule uses a date-only field while time remains separately canonical', () => {
  const adminView = read('views/tenant/exams/index.ejs');
  const adminCtrl = read('src/controllers/tenant/admin/examsController.js');
  const studentCtrl = read('src/controllers/tenant/students/examsController.js');
  assert.match(adminView, /name="examDate" type="date"/);
  assert.doesNotMatch(adminView, /name="examDate" type="datetime-local"/);
  assert.match(adminCtrl, /function parseDateOnly/);
  assert.match(studentCtrl, /localDateKey/);
});

test('Admin and Student Exam templates compile', () => {
  for (const rel of ['views/tenant/exams/index.ejs', 'views/students/exams.ejs']) {
    const file = path.join(root, rel);
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }), rel);
  }
});
