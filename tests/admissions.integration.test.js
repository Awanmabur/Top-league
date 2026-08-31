const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Applicant model persists document verification and review checklist metadata', () => {
  const src = read('src/models/tenant/Applicant.js');
  for (const token of ['verifiedAt', 'verifiedBy', 'reviewChecklist', 'checklistUpdatedAt', 'checklistUpdatedBy', 'interviewUpdatedAt', 'interviewUpdatedBy']) {
    assert.ok(src.includes(token), `missing ${token}`);
  }
});

test('Admin Admissions routes expose real review workflow actions', () => {
  const src = read('src/routes/tenant/admin/admissions.js');
  for (const route of [
    '/applicants/:id/cancel-interview',
    '/applicants/:id/documents/verify-all',
    '/applicants/:id/documents/:key/verify',
    '/applicants/:id/documents/upload',
    '/applicants/:id/checklist',
    '/applicants/:id/email',
    '/applicants/:id/sms',
  ]) assert.ok(src.includes(route), `missing ${route}`);
  assert.match(src, /upload\.single\("file"\), ctrl\.uploadApplicantDocument/);
});

test('Admin Admissions controller has one status handler and uses shared lifecycle/service rules', () => {
  const src = read('src/controllers/tenant/admin/admissionsController.js');
  assert.equal((src.match(/updateStatus:\s*async/g) || []).length, 1);
  assert.match(src, /assertApplicantTransition/);
  assert.match(src, /documentCompleteness/);
  assert.match(src, /normalizeChecklist/);
  assert.match(src, /sendMail/);
  assert.doesNotMatch(src, /adminNotes:\s*"Shortlisted for review"/);
});

test('public and Admin application creation both use the shared secure allocator', () => {
  for (const file of ['src/controllers/tenant/public/admissionsController.js', 'src/controllers/tenant/admin/admissionsController.js']) {
    const src = read(file);
    assert.match(src, /allocateApplicationId/);
    assert.doesNotMatch(src, /Math\.random/);
  }
  assert.doesNotMatch(read('src/utils/id.js'), /Math\.random/);
});

test('offer letter generation uses shared collision-resistant allocator rather than sequential last+1', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /allocateOfferLetterNo/);
  assert.doesNotMatch(src, /nextLetterNo/);
  assert.doesNotMatch(src, /parsed\s*\+\s*1/);
  assert.match(src, /target\.startsWith\(["\']\/admin\/admissions\/["\']\)/);
});

test('active applicant detail UI contains real forms and no UI-only/backend-later placeholders', () => {
  const view = read('views/tenant/admissions/applicant-view.ejs');
  const js = read('public/js/admin-applicant-detail.js');
  for (const action of [
    '/documents/verify-all', '/documents/upload', '/checklist', '/cancel-interview', '/email', '/sms', '/offer-letters/generate'
  ]) assert.ok(view.includes(action), `missing UI action ${action}`);
  assert.doesNotMatch(view, /data-ui-only|UI-only|UI ready|backend later|persist later|add endpoints later/i);
  assert.doesNotMatch(js, /data-ui-only|UI-only|backend later|\.innerHTML\s*=/i);
});

test('applicant detail does not count nonexistent certificates or invent Applicant payment/offer fields', () => {
  const view = read('views/tenant/admissions/applicant-view.ejs');
  assert.doesNotMatch(view, /key:\s*"certificates"/);
  for (const phantom of ['a.paymentStatus', 'a.feeAmount', 'a.applicationFee', 'a.paymentMethod', 'a.paymentRef', 'a.offerStatus', 'a.depositAmount', 'a.depositStatus']) {
    assert.ok(!view.includes(phantom), `phantom field remains: ${phantom}`);
  }
  assert.match(view, /latestOfferLetter/);
  assert.match(view, /does not invent payment state/);
});

test('applicant detail renders missing-doc and tag bootstrap through encoded data attributes and safe DOM rendering', () => {
  const view = read('views/tenant/admissions/applicant-view.ejs');
  const js = read('public/js/admin-applicant-detail.js');
  assert.match(view, /encodeURIComponent\(JSON\.stringify/);
  assert.match(js, /replaceChildren\(\)/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
});

test('legacy dead applicant-view browser script was removed', () => {
  assert.equal(fs.existsSync(path.join(root, 'public/js/applicant-view.js')), false);
});

test('Admissions migration is wired before tenant index creation', () => {
  const createIndexes = read('scripts/create-indexes.js');
  const packageJson = JSON.parse(read('package.json'));
  const migration = read('scripts/lib/migrateAdmissions.js');
  assert.match(createIndexes, /await migrateAdmissions\(tenantModels\)/);
  assert.equal(packageJson.scripts['migrate:admissions'], 'node scripts/migrate-admissions.js');
  assert.match(migration, /repairDuplicateField/);
  assert.match(migration, /allocateApplicationId/);
  assert.match(migration, /allocateOfferLetterNo/);
});

test('Applicant and OfferLetter unique identifiers remain database-enforced', () => {
  const applicant = read('src/models/tenant/Applicant.js');
  const offer = read('src/models/tenant/OfferLetter.js');
  assert.match(applicant, /\{ applicationId: 1 \}[\s\S]*unique:\s*true/);
  assert.match(offer, /\{ letterNo: 1 \}[\s\S]*unique:\s*true/);
});

test('changed Admissions EJS compiles', () => {
  const file = 'views/tenant/admissions/applicant-view.ejs';
  assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }));
});

test('Applicants list uses the same three required documents and RCDATA-safe JSON bootstrap', () => {
  const view = read('views/tenant/admissions/applicants.ejs');
  const js = read('public/js/admin-admissions-applicants.js');
  assert.match(view, /replace\(\/&\/g, "\\\\u0026"\).*replace\(\/<\/g, "\\\\u003c"\)/s);
  assert.match(js, /const total = 3;/);
  const docsPillBlock = js.slice(js.indexOf('function docsPill'), js.indexOf('function initials'));
  assert.doesNotMatch(docsPillBlock, /otherDocsCount/);
});

test('Offer Letters JSON is RCDATA-safe and HTML preview is sandboxed', () => {
  const view = read('views/tenant/offerLetters/index.ejs');
  const js = read('public/js/offer-letters-admin.js');
  assert.ok((view.match(/replace\(\/&\/g, "\\\\u0026"\)/g) || []).length >= 2);
  assert.match(view, /id="previewFrame" sandbox=""/);
  assert.match(js, /frame\.srcdoc/);
  assert.doesNotMatch(js, /contentWindow\.document/);
});

test('Offer-letter template values are escaped and active HTML content is rejected before generation/send', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /hasUnsafeTemplateHtml/);
  assert.match(src, /escapeValues:\s*true/);
  assert.match(src, /safeTenantName/);
  assert.match(src, /blocked active content/);
  assert.match(src, /stored letter contains blocked active HTML/);
});


test('active Admissions dashboard maps virtual received/interview stages onto canonical Applicant fields', () => {
  const ctrl = read('src/controllers/tenant/admin/admissionsController.js');
  const view = read('views/tenant/admissions/index.ejs');
  assert.match(ctrl, /status === "received"\) filter\.status = "submitted"/);
  assert.match(ctrl, /status === "interview"[\s\S]*filter\.status = "under_review"[\s\S]*filter\.interviewStatus = "Scheduled"/);
  assert.match(ctrl, /status interviewStatus interviewWhen createdAt/);
  assert.match(view, /const isInterviewScheduled/);
  assert.match(view, /displayStage/);
  assert.doesNotMatch(view, /<option value="received"[^>]*>Received<\/option>[\s\S]{0,500}<option value="interview"[^>]*>Interview<\/option>[\s\S]{0,500}<button class="btn-xs" type="submit"/);
  assert.ok(view.includes('<option value="submitted" <%= String(a.status||"").toLowerCase()==="submitted" ? "selected":"" %>>Received / Submitted</option>'));
});

test('active Admissions dashboard uses safe quick-view DOM and server-side filtered export', () => {
  const js = read('public/js/admission.js');
  assert.doesNotMatch(js, /mBody[^\n]*\.innerHTML\s*=|\$\('mBody'\)\.innerHTML\s*=/);
  assert.match(js, /body\.replaceChildren/);
  assert.match(js, /textContent/);
  assert.match(js, /\/admin\/admissions\/applicants\/export/);
  assert.doesNotMatch(js, /new Blob\(\[rows\.join/);
});

test('active Admissions quick actions navigate to real routes instead of placeholder alerts', () => {
  const view = read('views/tenant/admissions/index.ejs');
  const js = read('public/js/admission.js');
  assert.match(view, /href="\/admin\/reports" id="qReports"/);
  assert.match(view, /href="\/admin\/admissions\/intakes" id="qIntake"/);
  assert.doesNotMatch(view, /KPIs & exports \(next\)/i);
  assert.doesNotMatch(js, /Reports page next|Intake management next|qReports[^\n]*alert|qIntake[^\n]*alert/i);
});

test('active Admissions dashboard EJS compiles after lifecycle recovery', () => {
  const file = 'views/tenant/admissions/index.ejs';
  assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(root, file) }));
});


test('Admissions conversion is lease-guarded and orphan students are retired if finalization fails', () => {
  const controller = read('src/controllers/tenant/admin/admissionsController.js');
  const model = read('src/models/tenant/Applicant.js');
  for (const token of ['claimApplicantConversion', 'finalizeApplicantConversion', 'releaseApplicantConversion']) {
    assert.match(controller, new RegExp(token));
  }
  for (const field of ['conversionLockToken', 'conversionLockAt', 'conversionLockBy']) {
    assert.match(model, new RegExp(field));
  }
  assert.match(controller, /isDeleted:\s*true,\s*deletedAt:\s*new Date\(\),\s*status:\s*"inactive"/);
});

test('Admissions exports are spreadsheet-safe and checklist evidence cannot be self-asserted', () => {
  const controller = read('src/controllers/tenant/admin/admissionsController.js');
  assert.match(controller, /csvRows\.map\(\(row\)\s*=>\s*row\.map\(csvCell\)/);
  assert.match(controller, /rows\.map\(\(row\)\s*=>\s*row\.map\(csvCell\)/);
  assert.match(controller, /checklist\.identityVerified\s*=\s*checklist\.identityVerified\s*&&\s*applicant\.idDocument\?\.verified\s*===\s*true/);
  assert.match(controller, /checklist\.documentsComplete\s*=\s*checklist\.documentsComplete\s*&&\s*stats\.uploaded\s*===\s*stats\.total/);
});

test('Applicant document links accept only normal HTTP(S) URLs and offer actions return to the applicant view', () => {
  const view = read('views/tenant/admissions/applicant-view.ejs');
  const offer = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(view, /const safeHttpUrl\s*=/);
  assert.ok(view.includes('/^https?:\\/\\//i'));
  assert.doesNotMatch(view, /javascript:/i);
  assert.ok(view.includes('formaction="/admin/admissions/applicants/<%= a._id %>/sms"'));
  assert.ok(view.includes('/admin/admissions/offer-letters/<%= latestOffer._id %>/send'));
  assert.ok(view.includes('/admin/admissions/offer-letters/<%= latestOffer._id %>/void'));
  assert.match(offer, /target\.startsWith\(["\']\/admin\/admissions\/["\']\)/);
});
