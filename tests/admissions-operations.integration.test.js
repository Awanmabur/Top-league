const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Admissions POST mutations require admissions.manage while GET remains viewable', () => {
  const src = read('src/routes/tenant/admin/admissions.js');
  assert.match(src, /req\.method === ["']GET["'] \? next\(\) : requireTenantPermission\(["']admissions\.manage["']\)/);
});

test('Admissions route mount fails closed on Intake, Requirement and Offer models', () => {
  const src = read('src/routes/tenant/admin/index.js');
  for (const name of ['Applicant', 'Intake', 'AdmissionRequirement', 'OfferLetter', 'OfferLetterTemplate', 'Section']) assert.ok(src.includes(`"${name}"`));
  assert.match(src, /match:\s*["']all["']/);
});

test('Requirements CSV import route is real and memory-upload bounded by shared parser', () => {
  const route = read('src/routes/tenant/admin/admissions.js');
  const ctrl = read('src/controllers/tenant/admin/requirementsController.js');
  assert.match(route, /requirements\/import/);
  assert.match(route, /upload\.single\(["']file["']\)/);
  assert.match(ctrl, /parseCsvBuffer/);
  assert.match(ctrl, /maxBytes:\s*1024 \* 1024/);
});

test('Intake model enforces a database-level single-active invariant', () => {
  const src = read('src/models/tenant/Intake.js');
  assert.match(src, /one_active_intake/);
  assert.match(src, /partialFilterExpression:\s*\{\s*isDeleted:\s*false,\s*isActive:\s*true\s*\}/);
});

test('Intake lifecycle mutations are revision guarded', () => {
  const src = read('src/controllers/tenant/admin/intakeController.js');
  assert.match(src, /positiveRevision/);
  assert.match(src, /\{ _id: id, (?:isDeleted: \{ \$ne: true \}, )?revision/);
  assert.match(src, /\$inc:\s*\{ revision:\s*1 \}/);
});

test('Intake activation deactivates old active before claiming target and compensates failure', () => {
  const src = read('src/controllers/tenant/admin/intakeController.js');
  assert.match(src, /prior = await Intake\.findOne/);
  assert.match(src, /const on = await Intake\.updateOne/);
  assert.match(src, /if \(prior && priorDeactivated\)/);
});

test('Intake delete is blocked while referenced by applicants, offers or requirements', () => {
  const src = read('src/controllers/tenant/admin/intakeController.js');
  for (const name of ['Applicant', 'OfferLetter', 'AdmissionRequirement']) assert.ok(src.includes(name));
  assert.match(src, /dependency/i);
});

test('Intake import preflights rows and compensates a partial create batch', () => {
  const src = read('src/controllers/tenant/admin/intakeController.js');
  assert.match(src, /createdIds/);
  assert.match(src, /deleteMany/);
  assert.match(src, /parseCsvBuffer/);
});

test('Intake bulk status accepts id+revision items instead of naked ids', () => {
  const ctrl = read('src/controllers/tenant/admin/intakeController.js');
  const view = read('views/tenant/intakes/index.ejs');
  const js = read('public/js/intakes-index.js');
  assert.match(ctrl, /body\.items/);
  assert.ok(view.includes('name="items" id="bulkItems"'));
  assert.match(js, /revision:\s*Number\(row\?\.revision/);
});

test('Intake UI carries row revisions into active, status and delete actions', () => {
  const view = read('views/tenant/intakes/index.ejs');
  const js = read('public/js/intakes-index.js');
  assert.ok(view.includes('id="rowActionRevision"'));
  assert.match(js, /rowActionRevision/);
  assert.match(js, /it\.revision/);
});

test('Intake edit UI prevents deceptive active switch and uses dedicated Set Active lifecycle', () => {
  const js = read('public/js/intakes-index.js');
  assert.match(js, /mIsActive["']\)\.disabled = true/);
  assert.match(js, /\/active`/);
});

test('Intake Section rows expose application-open status to Admin', () => {
  const js = read('public/js/intakes-index.js');
  assert.match(js, /data-open/);
  assert.match(js, /isOpen/);
});

test('Public admissions only loads open Intake candidates and filters date windows', () => {
  const src = read('src/controllers/tenant/public/admissionsController.js');
  assert.match(src, /status:\s*["']open["']/);
  assert.match(src, /isIntakePubliclyOpen/);
});

test('Public admissions verifies selected Section belongs to selected Intake', () => {
  const src = read('src/controllers/tenant/public/admissionsController.js');
  assert.match(src, /intakeAllowsSection/);
});

test('Public application stores an immutable applicable-requirements snapshot', () => {
  const src = read('src/controllers/tenant/public/admissionsController.js');
  const model = read('src/models/tenant/Applicant.js');
  assert.match(src, /requirementSnapshot/);
  assert.match(src, /admissionRequirementsSnapshot/);
  assert.match(model, /RequirementSnapshotSchema/);
});

test('Public apply bootstraps are RCDATA escaped', () => {
  const view = read('views/tenant/public/admissions/apply.ejs');
  for (const code of ['\\\\u0026', '\\\\u003c', '\\\\u003e']) assert.ok(view.includes(code));
});

test('Public requirement renderer uses DOM text APIs rather than data-backed innerHTML', () => {
  const src = read('public/js/apply.js');
  assert.match(src, /dynamicRequirements/);
  assert.match(src, /textContent/);
  assert.doesNotMatch(src, /dynamicRequirements[^\n]*\.innerHTML\s*=/);
});

test('Requirement model has revision and migration quarantine evidence', () => {
  const src = read('src/models/tenant/AdmissionRequirement.js');
  assert.match(src, /revision/);
  assert.match(src, /migrationQuarantined/);
  assert.match(src, /quarantineReason/);
});

test('Requirement create/update enforce nonempty scoped Section and Intake selections', () => {
  const src = read('src/controllers/tenant/admin/requirementsController.js');
  assert.match(src, /normalizeRequirementScope/);
  assert.match(src, /assertScopeReferences/);
});

test('Requirement updates and deletes are optimistic-revision guarded', () => {
  const src = read('src/controllers/tenant/admin/requirementsController.js');
  assert.match(src, /positiveRevision/);
  assert.match(src, /revision/);
  assert.match(src, /\$inc:\s*\{ revision:\s*1 \}/);
});

test('Requirement UI carries revisions for edit, delete, toggle and bulk', () => {
  const view = read('views/tenant/requirements/index.ejs');
  const js = read('public/js/requirements-index.js');
  assert.ok(view.includes('id="mRevision"'));
  assert.ok(view.includes('id="rowActionRevision"'));
  assert.ok(view.includes('id="bulkItems"'));
  assert.match(js, /revision:\s*Number\(row\?\.revision/);
});

test('Requirement browser limits align with schema/controller limits', () => {
  const view = read('views/tenant/requirements/index.ejs');
  assert.ok(view.includes('maxlength="120"'));
  assert.ok(view.includes('maxlength="40"'));
  assert.ok(view.includes('maxlength="700"'));
});

test('Offer model guarantees one current nondeleted offer per applicant+Intake key', () => {
  const src = read('src/models/tenant/OfferLetter.js');
  assert.match(src, /currentKey/);
  assert.match(src, /one_current_offer_per_applicant_intake/);
});

test('Offer generation freezes applicant/intake/requirements content and template revision', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  for (const token of ['snapshot', 'requirementsSnapshot', 'templateRevision', 'contentHash', 'currentKey']) assert.ok(src.includes(token));
});

test('Offer send verifies content integrity before claiming delivery', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /offerContentHash/);
  assert.match(src, /contentHash/);
  assert.match(src, /deliveryStatus:\s*["']sending["']/);
});

test('Offer send claim is compare-and-set and increments revision before mail', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /sendClaimToken/);
  assert.match(src, /revision/);
  assert.match(src, /\$inc:\s*\{[^}]*sendAttempts:\s*1[^}]*revision:\s*1/);
  assert.ok(src.indexOf("deliveryStatus: 'sending'") < src.indexOf('sendMail('));
});

test('Offer mail failure becomes failed rather than resetting to an unclaimed draft', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /deliveryStatus:\s*["']failed["']/);
  assert.doesNotMatch(src, /deliveryStatus:\s*["']not_sent["'][\s\S]{0,180}sendMail/);
});

test('Post-send persistence uncertainty remains sending and explicitly blocks resend', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /do not resend/i);
  assert.match(src, /deliveryStatus:\s*["']sending["']/);
});

test('Offer void is revision guarded, reasoned and clears currentKey', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /voidReason/);
  assert.match(src, /currentKey:\s*null/);
  assert.match(src, /reason.*5/i);
});

test('Offer template is a revisioned singleton', () => {
  const model = read('src/models/tenant/OfferLetterTemplate.js');
  const ctrl = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(model, /one_offer_template_singleton/);
  assert.match(ctrl, /singletonKey:\s*["']default["']/);
  assert.match(ctrl, /positiveRevision/);
});

test('Offer template HTML blocks active content and event-handler injection', () => {
  const src = read('src/controllers/tenant/admin/offerLettersController.js');
  assert.match(src, /script\|iframe\|object\|embed\|form/i);
  assert.match(src, /on\[a-z\]/i);
  assert.match(src, /javascript/);
});

test('Offer Admin UI carries send/void/template revision tokens and void reason', () => {
  const view = read('views/tenant/offerLetters/index.ejs');
  const js = read('public/js/offer-letters-admin.js');
  for (const id of ['sendRevision', 'voidRevision', 'voidReason']) assert.ok(view.includes(`id="${id}"`));
  assert.match(js, /sendRevision/);
  assert.match(js, /voidRevision/);
  assert.match(view, /template\?\.revision/);
});

test('Offer UI does not expose normal send action for sent or in-flight letters', () => {
  const js = read('public/js/offer-letters-admin.js');
  assert.match(js, /l\.status === ["']draft["']/);
  assert.match(js, /l\.deliveryStatus !== ["']sending["']/);
});

test('Applicant detail direct offer actions carry revisions and require a void reason', () => {
  const view = read('views/tenant/admissions/applicant-view.ejs');
  assert.match(view, /latestOffer\.revision/);
  assert.match(view, /name="reason" required minlength="5"/);
  assert.match(view, /latestOffer\.deliveryStatus !== "sending"/);
});

test('Applicant detail controller retrieves offer revision/delivery state', () => {
  const src = read('src/controllers/tenant/admin/admissionsController.js');
  assert.match(src, /letterNo status revision deliveryStatus/);
});

test('Admissions operations migration is wired before tenant index synchronization', () => {
  const idx = read('scripts/create-indexes.js');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(idx.includes('migrateAdmissionsOperations'));
  assert.ok(idx.indexOf('await migrateAdmissionsOperations') < idx.indexOf('createModelIndexes(label, tenantModels)'));
  assert.equal(pkg.scripts['migrate:admissions-operations'], 'node scripts/migrate-admissions-operations.js');
});

test('Admissions operation templates compile', () => {
  for (const file of ['views/tenant/intakes/index.ejs','views/tenant/requirements/index.ejs','views/tenant/offerLetters/index.ejs','views/tenant/admissions/applicant-view.ejs','views/tenant/public/admissions/apply.ejs']) {
    assert.doesNotThrow(() => ejs.compile(read(file), { filename: path.join(ROOT, file) }), file);
  }
});
