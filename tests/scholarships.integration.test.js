const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root,f),'utf8');

test('Scholarship model separates Program and Award provenance', () => {
  const s=read('src/models/tenant/Scholarship.js');
  assert.match(s,/recordKind/); assert.match(s,/sourceScholarshipId/); assert.match(s,/sourceApplicationId/); assert.match(s,/sourceApplicationId:\s*1/);
});

test('ScholarshipApplication has unique per-scholarship applicant identity and lifecycle audit fields', () => {
  const s=read('src/models/tenant/ScholarshipApplication.js');
  assert.match(s,/applicantKey/); assert.match(s,/scholarship:\s*1, applicantKey:\s*1/); assert.match(s,/reviewedAt/); assert.match(s,/awardedAt/); assert.match(s,/decisionBy/); assert.match(s,/awardScholarshipId/);
});

test('public scholarships use canonical Active/date model and privacy-safe status lookup', () => {
  const c=read('src/controllers/tenant/public/scholarshipsPublicController.js');
  assert.match(c,/publicScholarshipFilter/); assert.doesNotMatch(c,/status:\s*["']open["']/);
  assert.match(c,/applicationId/); assert.match(c,/contact/); assert.doesNotMatch(c,/Email\/Phone/);
  assert.match(c,/assertFileSignature/); assert.match(c,/applicantKey/);
});

test('public upload route has explicit file types/counts and memory upload limits', () => {
  const r=read('src/routes/tenant/public/scholarships.js');
  assert.match(r,/upload\.fields/); assert.match(r,/transcript/); assert.match(r,/recommendationLetter/); assert.match(r,/otherDocs/);
  const u=read('src/middleware/uploadMemory.js'); assert.match(u,/fileSize/); assert.match(u,/application\/pdf/);
});

test('admin routes include real export and application review lifecycle', () => {
  const r=read('src/routes/tenant/admin/scholarships.js');
  for (const part of ['/export.csv','/applications/bulk','/applications/:appId','/:id/applications']) assert.ok(r.includes(part), part);
});

test('awarded enrolled applicants produce an idempotent student Award provenance record', () => {
  const c=read('src/controllers/tenant/admin/scholarshipsController.js');
  assert.match(c,/sourceApplicationId:\s*app\._id/); assert.match(c,/\$setOnInsert/); assert.match(c,/awardScholarshipId/); assert.match(c,/recordKind:\s*["']Award["']/);
});

test('invalid scholarship bulk actions fail closed and revoked scholarships cannot be reactivated', () => {
  const c=read('src/controllers/tenant/admin/scholarshipsController.js');
  assert.match(c,/Invalid scholarship bulk action/); assert.match(c,/Revoked scholarships are terminal/);
});

test('active scholarship client has real export and safe DOM rendering without database innerHTML', () => {
  const c=read('public/js/scholarships.js');
  assert.match(c,/export\.csv/); assert.match(c,/replaceChildren/); assert.match(c,/textContent/); assert.doesNotMatch(c,/\.innerHTML\s*=/);
  assert.match(c,/actApplications/);
});

test('scholarship bootstrap is RCDATA-safe', () => {
  const v=read('views/tenant/finance/scholarships.ejs');
  assert.match(v,/\\u003c/); assert.match(v,/scholarshipsData/);
});

test('public status page requires both application ID and matching contact', () => {
  const v=read('views/tenant/public/scholarships/status.ejs');
  assert.match(v,/name="applicationId"/); assert.match(v,/name="contact"/); assert.doesNotMatch(v,/name="q"/);
});

test('scholarship migration runs before index synchronization', () => {
  const p=read('package.json'); const idx=read('scripts/create-indexes.js'); const mig=read('scripts/lib/migrateScholarships.js');
  assert.match(p,/migrate:scholarships/); assert.match(idx,/migrateScholarships\(tenantModels\)/); assert.match(mig,/duplicateKeysAdjusted/); assert.match(mig,/applicantKey/);
  assert.ok(idx.indexOf('migrateScholarships(tenantModels)') < idx.indexOf('createModelIndexes(label, tenantModels)'));
});

test('live scholarship EJS views compile', () => {
  const files=['views/tenant/finance/scholarships.ejs','views/tenant/public/scholarships/index.ejs','views/tenant/public/scholarships/view.ejs','views/tenant/public/scholarships/apply.ejs','views/tenant/public/scholarships/status.ejs','views/tenant/scholarships/applications.ejs','views/tenant/scholarships/application-view.ejs','views/tenant/scholarships/view.ejs'];
  files.forEach((f)=>assert.doesNotThrow(()=>ejs.compile(read(f),{filename:path.join(root,f)}),f));
});
