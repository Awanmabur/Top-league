const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');

test('academic hierarchy admin mounts fail closed on complete canonical model sets', () => {
  const src = read('src/routes/tenant/admin/index.js');
  assert.match(src, /\/classes"[\s\S]*requireTenantModels\(\["Class", "Student", "Section", "Stream", "Subject"\]/);
  assert.match(src, /\/sections"[\s\S]*requireTenantModels\(\["Section", "Class", "Student", "Stream", "Subject"\]/);
  assert.match(src, /\/streams"[\s\S]*requireTenantModels\(\["Stream", "Class", "Section", "Student", "Subject"\]/);
  assert.match(src, /\/subjects"[\s\S]*requireTenantModels\(\["Subject", "Class", "Section", "Stream"\]/);
});

test('Subject create and update routes actually run declared validation rules', () => {
  const src = read('src/routes/tenant/admin/subjects.js');
  assert.match(src, /router\.post\("\/", subjectsCtrl\.subjectRules, subjectsCtrl\.create\)/);
  assert.match(src, /router\.post\("\/:id", subjectsCtrl\.subjectRules, subjectsCtrl\.update\)/);
});

test('all four academic hierarchy modules expose server-side filtered CSV exports', () => {
  for (const [route, ctrl] of [['classes','classesController.js'],['sections','sectionsController.js'],['streams','streamsController.js'],['subjects','subjectsController.js']]) {
    assert.match(read(`src/routes/tenant/admin/${route}.js`), /\/export\.csv/);
    const src=read(`src/controllers/tenant/admin/${ctrl}`);
    assert.match(src, /exportCsv/); assert.match(src, /csvCell/);
  }
});

test('academic search paths escape user regex input', () => {
  for (const file of ['classesController.js','sectionsController.js','streamsController.js','subjectsController.js']) {
    const src=read(`src/controllers/tenant/admin/${file}`);
    assert.match(src, /escapeRegExp/);
  }
});

test('class/section/stream enrollment count inputs are read-only derived values', () => {
  for (const dir of ['classes','sections','streams']) {
    const src=read(`views/tenant/${dir}/index.ejs`);
    assert.match(src, /id="mEnrolledCount"[^>]*readonly/);
  }
});

test('academic JSON bootstraps are RCDATA escaped', () => {
  for (const dir of ['classes','sections','streams','subjects']) {
    const src=read(`views/tenant/${dir}/index.ejs`);
    const blocks=[...src.matchAll(/<textarea[^>]+class="json-data"[\s\S]*?<%-([\s\S]*?)%><\/textarea>/g)];
    assert.ok(blocks.length>0, `${dir}: expected JSON bootstrap`);
    for (const m of blocks) assert.match(m[1], /replace\(\/<\/g, "\\\\u003c"\)/, `${dir}: unsafe textarea bootstrap`);
  }
});

test('academic clients use server export endpoints instead of page-limited client CSV as active handler', () => {
  const paths={classes:'/admin/classes/export.csv',sections:'/admin/sections/export.csv',streams:'/admin/streams/export.csv',subjects:'/admin/subjects/export.csv'};
  for(const [name,url] of Object.entries(paths)) assert.ok(read(`public/js/${name}.js`).includes(url));
});

test('academic catalog migration is wired before tenant indexes', () => {
  const pkg=JSON.parse(read('package.json')); assert.equal(pkg.scripts['migrate:academic-catalog'],'node scripts/migrate-academic-catalog.js');
  const src=read('scripts/create-indexes.js');
  const migration=src.indexOf('migrateAcademicCatalog(tenantModels)'); const indexes=src.indexOf('createModelIndexes(label, tenantModels)');
  assert.ok(migration>=0 && indexes>migration);
});

test('academic migration repairs codes, orphan links and enrollment counts', () => {
  const src=read('scripts/lib/migrateAcademicCatalog.js');
  assert.match(src,/repairCodes/); assert.match(src,/orphanedArchived/); assert.match(src,/syncEnrollmentCounts/);
});

test('controllers override unsafe bulk delete/updateMany lifecycle paths with per-record guards', () => {
  for(const file of ['classesController.js','sectionsController.js','streamsController.js','subjectsController.js']){
    const src=read(`src/controllers/tenant/admin/${file}`);
    assert.match(src,/assertDeleteAllowed/); assert.match(src,/assertStatusAllowed/); assert.match(src,/module\.exports\.bulk = async function guarded/);
  }
});

test('academic hierarchy EJS templates compile', () => {
  for(const dir of ['classes','sections','streams','subjects']){
    const file=path.join(root,`views/tenant/${dir}/index.ejs`);
    assert.doesNotThrow(()=>ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}),dir);
  }
});
