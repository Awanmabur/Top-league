const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Student model has unique active registration, student number, and linked-user indexes', () => {
  const src = read('src/models/tenant/Student.js');
  assert.match(src, /\{ studentNo: 1 \}[\s\S]*unique: true/);
  assert.match(src, /\{ regNo: 1 \}[\s\S]*unique: true/);
  assert.match(src, /\{ userId: 1 \}[\s\S]*unique: true/);
  assert.match(src, /legacyRegNo/);
});

test('tenant User records distinguish student-lifecycle suspension from manual suspension', () => {
  const src = read('src/models/tenant/User.js');
  assert.match(src, /studentAccessSuspended:\s*\{ type: Boolean, default: false \}/);
  assert.match(src, /staffAccessSuspended/);
});

test('registration allocator uses atomic Counter and never Math.random', () => {
  const src = read('src/utils/regNo.js');
  assert.match(src, /findOneAndUpdate/);
  assert.match(src, /crypto\.randomBytes/);
  assert.doesNotMatch(src, /Math\.random/);
});

test('Admin Students routes expose real filtered export and CSV import', () => {
  const src = read('src/routes/tenant/admin/students.js');
  assert.match(src, /router\.get\("\/export", ctrl\.exportCsv\)/);
  assert.match(src, /router\.post\("\/import", upload\.single\("file"\), ctrl\.importCsv\)/);
  assert.doesNotMatch(src, /\/\/ router\.get\("\/export"/);
});

test('Student controller import is implemented and bounded instead of stubbed', () => {
  const src = read('src/controllers/tenant/admin/studentsController.js');
  assert.match(src, /csv\(\{ mapHeaders/);
  assert.match(src, /rows\.length < 2000/);
  assert.match(src, /Imported \$\{created\} student/);
  assert.doesNotMatch(src, /CSV import was not changed/);
});

test('Student bulk and row lifecycle actions use the shared lifecycle service', () => {
  const src = read('src/controllers/tenant/admin/studentsController.js');
  const matches = src.match(/applyStudentLifecycle\(/g) || [];
  assert.ok(matches.length >= 7, `expected shared lifecycle usage, found ${matches.length}`);
  assert.doesNotMatch(src, /Student\.updateMany\([^)]*\{ \$set: \{ status/);
});

test('Student deletion detaches stale parent authorization links', () => {
  const service = read('src/services/tenant/studentLifecycleService.js');
  assert.match(service, /detachStudentFromParents/);
  assert.match(service, /\$pull: \{ childrenStudentIds:/);
  assert.match(service, /options\.deleting/);
});

test('Student status suspension revokes sessions and reactivation only reverses student-caused suspension', () => {
  const service = read('src/services/tenant/studentLifecycleService.js');
  assert.match(service, /studentAccessSuspended/);
  assert.match(service, /\$inc: \{ tokenVersion: 1 \}/);
  assert.match(service, /invalidateTenantUserCache/);
  assert.match(service, /studentAccessSuspended: true/);
});

test('student portal auth validates the linked active Student record', () => {
  const src = read('src/middleware/tenant/requireTenantAuth.js');
  assert.match(src, /primaryRole === "student"/);
  assert.match(src, /user\.studentId/);
  assert.match(src, /status: \{ \$nin: \["suspended", "archived"\] \}/);
  assert.match(src, /Student access disabled/);
});

test('Student migration repairs identifiers and duplicate auth links before indexes', () => {
  const createIndexes = read('scripts/create-indexes.js');
  const migration = read('scripts/lib/migrateStudents.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(createIndexes, /migrateStudents\(tenantModels\)/);
  assert.match(migration, /repairedRegNos/);
  assert.match(migration, /duplicateUserLinksCleared/);
  assert.equal(pkg.scripts['migrate:students'], 'node scripts/migrate-students.js');
});

test('Student export is formula-safe and respects the live filter builder', () => {
  const src = read('src/controllers/tenant/admin/studentsController.js');
  assert.match(src, /const filter = buildStudentFilter/);
  assert.match(src, /\.map\(csvCell\)\.join\(","\)/);
  assert.match(src, /Content-Disposition/);
});

test('Student page JSON bootstraps are RCDATA-safe', () => {
  const src = read('views/tenant/students/index.ejs');
  const safe = src.match(/JSON\.stringify\([^\n]+\)\.replace\(\/<\/g, "\\\\u003c"\)/g) || [];
  assert.ok(safe.length >= 6, `expected six safe JSON bootstraps, found ${safe.length}`);
});

test('active Student client avoids database-backed innerHTML rendering', () => {
  const src = read('public/js/students.js');
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(src, /replaceChildren/);
  assert.match(src, /textContent/);
});

test('Student UI exposes real Export and accurate CSV import guidance', () => {
  const view = read('views/tenant/students/index.ejs');
  const client = read('public/js/students.js');
  assert.match(view, /id="btnExport"/);
  assert.match(client, /\/admin\/students\/export/);
  assert.match(view, /Registration numbers may be left blank for secure auto-generation/);
});

test('active Students EJS compiles after lifecycle hardening', () => {
  assert.doesNotThrow(() => ejs.compile(read('views/tenant/students/index.ejs'), { filename: path.join(root, 'views/tenant/students/index.ejs') }));
});

test('manual User status actions clear Student lifecycle suspension ownership', () => {
  const src = read('src/controllers/tenant/admin/usersController.js');
  const clears = src.match(/studentAccessSuspended:\s*false/g) || [];
  assert.ok(clears.length >= 5, `expected manual user actions to clear student suspension ownership, found ${clears.length}`);
  assert.match(src, /studentAccessPreviousStatus:\s*null/);
});

test('Student lifecycle preserves invited-vs-active state across lifecycle suspension', () => {
  const model = read('src/models/tenant/User.js');
  const service = read('src/services/tenant/studentLifecycleService.js');
  assert.match(model, /studentAccessPreviousStatus/);
  assert.match(service, /set\.studentAccessPreviousStatus/);
  assert.match(service, /const restoredStatus/);
  assert.match(service, /studentAccessPreviousStatus:\s*null/);
});

test('Student update synchronizes changed Student and guardian account identities', () => {
  const src = read('src/controllers/tenant/admin/studentsController.js');
  assert.match(src, /assertIdentityAccountCompatibility/);
  assert.match(src, /findOrCreateStudentUser\(\{ req, StudentDoc: updatedStudent/);
  assert.match(src, /updatedStudent\.guardianEmail/);
  assert.match(src, /guardianUserId: null/);
});

test('Student import retries generated regNo races and reports account-link review without falsely skipping created rows', () => {
  const src = read('src/controllers/tenant/admin/studentsController.js');
  assert.match(src, /createStudentWithRegRetry\(Student/);
  assert.match(src, /autoGeneratedRegNo/);
  assert.match(src, /student imported, but account linkage requires review/);
});

test('Student migration normalizes legacy lifecycle state and repairs both Parent and User child authorization', () => {
  const migration = read('scripts/lib/migrateStudents.js');
  assert.match(migration, /normalizeLegacyStatus/);
  assert.match(migration, /typeof row\.isDeleted !== 'boolean'/);
  assert.match(migration, /parentUserLinksRepaired/);
  assert.match(migration, /staleUserStudentLinksCleared/);
  assert.match(migration, /lifecycleSuspensionsBackfilled/);
});
