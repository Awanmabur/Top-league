const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');

test('Admin Transcripts fail closed on canonical transcript/result/academic models', () => {
  const src=read('src/routes/tenant/admin/index.js');
  assert.match(src,/\/transcripts"[\s\S]*requireTenantModels\(\["Transcript", "Student", "Result", "Class", "Section", "Stream", "Subject"\], \{ match: "all" \}\)/);
});

test('Student and Parent transcript surfaces require Transcript plus canonical Result models', () => {
  const student=read('src/routes/tenant/students/index.js');
  const parent=read('src/routes/tenant/parents/index.js');
  assert.match(student,/requireTenantModels\(\["Student", "Transcript", "Result", "Exam", "Subject"\], \{ match: "all" \}\)[\s\S]*require\("\.\/transcript"\)/);
  assert.match(parent,/requireTenantModels\(\["Student", "Result", "Exam", "Subject"\], \{ match: "all" \}\)[\s\S]*requireTenantModels\(\["Transcript"\], \{ match: "all" \}\)[\s\S]*require\("\.\/results"\)/);
});

test('Admin transcript issuance uses shared guarded issue path and no blind bulk update/delete', () => {
  const src=read('src/controllers/tenant/admin/transcriptsController.js');
  for(const token of ['issueOne','assertTranscriptEditable','assertTranscriptDeleteAllowed','assertTranscriptRevokeAllowed','assertTranscriptIssueAllowed','snapshotIntegrityOk']) assert.ok(src.includes(token),token);
  assert.doesNotMatch(src,/Transcript\.updateMany\(/);
  assert.doesNotMatch(src,/Transcript\.deleteMany\(/);
});

test('official issuance forces published-only source results and records result provenance', () => {
  const src=read('src/controllers/tenant/admin/transcriptsController.js');
  assert.match(src,/buildTranscriptLive\(req, \{ \.\.\.transcriptDoc, includeDraftResults: false \}, \{ issuing: true \}\)/);
  assert.match(src,/sourceResults: filtered\.map/);
  const svc=read('src/services/tenant/transcriptService.js');
  assert.match(svc,/if \(issuing \|\| kind === "official"\) return "published"/);
});

test('transcript generation preflights before create/update so no-result requests do not leave empty drafts', () => {
  const src=read('src/controllers/tenant/admin/transcriptsController.js');
  const live=src.indexOf('const live = await buildTranscriptLive(req, { ...base');
  const create=src.indexOf('Transcript.create({ ...base');
  assert.ok(live>=0 && create>live);
});

test('Admin transcript search escapes user regex input', () => {
  const src=read('src/controllers/tenant/admin/transcriptsController.js');
  assert.match(src,/const rx = escapeRegExp\(q\)/);
  assert.match(src,/\$regex: rx/);
});

test('issued and revoked Admin preview/print use immutable snapshots', () => {
  const src=read('src/controllers/tenant/admin/transcriptsController.js');
  assert.match(src,/\["issued", "revoked"\]\.includes\(tdoc\.status\)/);
  assert.match(src,/transcriptDisplaySnapshot\(tdoc\)/);
});

test('verification validates snapshot integrity and signature bound to hash', () => {
  const svc=read('src/services/tenant/transcriptService.js');
  assert.match(svc,/verificationPayload/);
  assert.match(svc,/snapshotHash/);
  assert.match(svc,/snapshotIntegrityOk/);
  assert.match(svc,/crypto\.timingSafeEqual/);
  const ctrl=read('src/controllers/tenant/admin/transcriptsController.js');
  assert.match(ctrl,/verifyTranscriptCredential\(tdoc, sig\)/);
  assert.match(ctrl,/migrationQuarantinedAt: null/);
});

test('transcript issue numbers are random-shaped and model has active unique index', () => {
  const svc=read('src/services/tenant/transcriptService.js');
  assert.match(svc,/crypto\.randomBytes/);
  assert.match(svc,/CA-TR-\$\{y\}\$\{m\}\$\{d\}-\$\{entropy\}/);
  const model=read('src/models/tenant/Transcript.js');
  assert.match(model,/name: "uniq_issued_transcript_number"/);
  assert.match(model,/partialFilterExpression: \{ issuedAt: \{ \$type: "date" \}, migrationQuarantinedAt: null \}/);
});

test('Transcript migration is wired after Results and before tenant index creation', () => {
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['migrate:transcripts'],'node scripts/migrate-transcripts.js');
  const src=read('scripts/create-indexes.js');
  const results=src.indexOf('migrateResults(tenantModels)');
  const transcripts=src.indexOf('migrateTranscripts(tenantModels)');
  const indexes=src.indexOf('createModelIndexes(label, tenantModels)');
  assert.ok(results>=0 && transcripts>results && indexes>transcripts);
});

test('Transcript migration repairs verification state, quarantines unsafe credentials and replaces conflicting indexes', () => {
  const src=read('scripts/lib/migrateTranscripts.js');
  for(const token of ['normalizeTranscriptStatus','migrationQuarantinedAt','snapshotHash','duplicatesQuarantined','dropConflictingTranscriptIndexes','ensureTranscriptIndex']) assert.ok(src.includes(token),token);
});

test('Admin transcript JSON bootstraps are RCDATA escaped', () => {
  const src=read('views/tenant/transcripts/index.ejs');
  const blocks=[...src.matchAll(/<textarea[^>]+class="json-data"[\s\S]*?<%-([\s\S]*?)%><\/textarea>/g)];
  assert.ok(blocks.length>=4);
  for(const m of blocks) assert.ok(m[1].includes(String.raw`replace(/</g, "\\u003c")`));
});

test('Transcript client restricts draft-result option to unofficial preview and requires bulk revoke reason', () => {
  const src=read('public/js/transcripts.js');
  assert.match(src,/const official = mKind\.value === "official"/);
  assert.match(src,/mIncludeDraft\.disabled = official/);
  assert.match(src,/Reason for revoking the selected issued transcripts/);
  assert.doesNotMatch(src,/\.innerHTML\s*=/);
});

test('Student transcript is school-term based and no longer invents GPA credits or semesters', () => {
  const ctrl=read('src/controllers/tenant/students/transcriptController.js');
  assert.match(ctrl,/summarizePublishedResults/);
  assert.match(ctrl,/studentPublishedResultFilter\(student\._id\)/);
  const view=read('views/students/transcript.ejs');
  assert.match(view,/Overall average/);
  assert.match(view,/Latest term average/);
  assert.match(view,/Subjects passed/);
  assert.doesNotMatch(view,/CGPA|grade points|Total credits|semester/i);
});

test('Student official transcript print is ownership-scoped and integrity checked', () => {
  const routes=read('src/routes/tenant/students/transcript.js');
  const ctrl=read('src/controllers/tenant/students/transcriptController.js');
  assert.match(routes,/\/transcript\/:id\/print/);
  assert.match(ctrl,/student: student\._id/);
  assert.match(ctrl,/status: "issued"/);
  assert.match(ctrl,/snapshotIntegrityOk\(tdoc\)/);
});

test('Parent official transcript access is linked-child scoped and never exposes arbitrary student credentials', () => {
  const routes=read('src/routes/tenant/parents/results.js');
  const ctrl=read('src/controllers/tenant/parents/resultsController.js');
  assert.match(routes,/\/results\/:studentId\/transcript\/:id\/print/);
  assert.match(ctrl,/canAccessChild\(parent, studentId\)/);
  assert.match(ctrl,/student: studentId/);
  assert.match(ctrl,/snapshotIntegrityOk\(tdoc\)/);
});

test('Transcript templates compile', () => {
  for(const rel of ['views/tenant/transcripts/index.ejs','views/tenant/transcripts/print.ejs','views/tenant/transcripts/verify-transcript.ejs','views/students/transcript.ejs','views/parents/results.ejs']) {
    const file=path.join(root,rel);
    assert.doesNotThrow(()=>ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}),rel);
  }
});
