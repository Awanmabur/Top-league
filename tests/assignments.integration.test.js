const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ejs=require('ejs');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('Admin Assignments fail closed on canonical coursework, academic, student and notification models',()=>{
  const src=read('src/routes/tenant/admin/index.js');
  assert.match(src,/\/assignments"[\s\S]*requireTenantModels\(\["Assignment", "AssignmentSubmission", "Subject", "Class", "Section", "Stream", "Student", "Notification"\], \{ match: "all" \}\)/);
});

test('Student Assignments fail closed on AssignmentSubmission plus canonical academic identity models',()=>{
  const src=read('src/routes/tenant/students/index.js');
  assert.match(src,/requireTenantModels\(\["Assignment", "AssignmentSubmission", "Student", "Subject"\], \{ match: "all" \}\)[\s\S]*require\("\.\/assignments"\)/);
});

test('AssignmentSubmission is registered in the tenant model loader',()=>{
  assert.match(read('src/models/tenant/loadModels.js'),/AssignmentSubmission: defineModel\("AssignmentSubmission"\)/);
});

test('Student Assignment reader uses canonical scoped visibility instead of legacy studentId/programId/classId assignment fields',()=>{
  const src=read('src/controllers/tenant/students/assignmentsController.js');
  assert.match(src,/assignmentVisibilityFilterForStudent\(student\)/);
  assert.match(src,/AssignmentSubmission\.find\(\{ student: student\._id/);
  assert.doesNotMatch(src,/assignedToStudents|programId/);
  assert.doesNotMatch(src,/Assignment\.find\([\s\S]{0,180}studentId/);
});

test('Student Assignment routes expose detail, submit and withdraw operations',()=>{
  const src=read('src/routes/tenant/students/assignments.js');
  assert.match(src,/router\.get\("\/assignments\/:id", ctrl\.detail\)/);
  assert.match(src,/router\.post\("\/assignments\/:id\/submit", ctrl\.submit\)/);
  assert.match(src,/router\.post\("\/assignments\/:id\/withdraw", ctrl\.withdraw\)/);
});

test('student submit/resubmit uses revision/status compare-and-set and duplicate uniqueness protection',()=>{
  const src=read('src/controllers/tenant/students/assignmentsController.js');
  assert.match(src,/revision: Number\(current\.revision \|\| 0\)/);
  assert.match(src,/gradeRevision: Number\(current\.gradeRevision \|\| 0\)/);
  assert.match(src,/err\?\.code === 11000/);
  assert.match(src,/buildStudentSubmissionValues/);
});

test('Admin assignment lifecycle uses shared guards and never blind updateMany on Assignment business rows',()=>{
  const src=read('src/controllers/tenant/admin/assignmentController.js');
  for(const token of ['assertAssignmentEditable','assertAssignmentDeleteAllowed','assignmentStatusUpdate','applyBulkWithCompensation','countAssignmentSubmissions'])assert.ok(src.includes(token),token);
  assert.doesNotMatch(src,/Assignment\.updateMany\(/);
});

test('Admin grade/reopen is canonical AssignmentSubmission compare-and-set',()=>{
  const src=read('src/controllers/tenant/admin/assignmentController.js');
  assert.match(src,/gradeSubmissionUpdate/);
  assert.match(src,/reopenSubmissionUpdate/);
  assert.match(src,/status:"submitted",gradeRevision:Number\(submission\.gradeRevision\|\|0\)/);
  assert.match(src,/status:"graded",gradeRevision:Number\(submission\.gradeRevision\|\|0\)/);
});

test('Assignment import/bulk/submission routes are declared before the generic :id update',()=>{
  const src=read('src/routes/tenant/admin/assignments.js');
  const generic=src.indexOf('router.post("/:id",');
  for(const token of ['router.post("/import"','router.post("/bulk"','router.get("/:id/submissions"'])assert.ok(src.indexOf(token)>=0&&src.indexOf(token)<generic,token);
});

test('Assignment CSV import validates the whole file before writing and has compensation',()=>{
  const src=read('src/controllers/tenant/admin/assignmentController.js');
  assert.match(src,/Import rejected before writing/);
  assert.match(src,/insertPreparedWithCompensation/);
  assert.match(src,/1,000 assignment rows/);
  assert.match(src,/import status must be draft or published/);
});

test('Assignment search escapes regex and export uses formula-safe csvCell',()=>{
  const src=read('src/controllers/tenant/admin/assignmentController.js');
  assert.match(src,/const rx=escapeRegExp\(q\)/);
  assert.match(src,/\.map\(csvCell\)\.join\(","\)/);
  assert.match(read('src/routes/tenant/admin/assignments.js'),/export\.csv/);
});

test('Admin Assignment JSON bootstraps are RCDATA escaped',()=>{
  const src=read('views/tenant/assignments/index.ejs');
  const blocks=[...src.matchAll(/<textarea[^>]+class="json-data"[\s\S]*?<%-([\s\S]*?)%><\/textarea>/g)];
  assert.ok(blocks.length>=5);
  for(const m of blocks) assert.ok(m[1].includes(String.raw`replace(/</g, "\\u003c")`));
});

test('Assignment client renders database values through DOM APIs rather than HTML injection',()=>{
  const src=read('public/js/assignments.js');
  assert.doesNotMatch(src,/\.innerHTML\s*=/);
  assert.doesNotMatch(src,/insertAdjacentHTML/);
  assert.match(src,/textContent/);
  assert.match(src,/replaceChildren/);
});

test('Assignment model retains lifecycle, scope, late-submission and quarantine evidence',()=>{
  const src=read('src/models/tenant/Assignment.js');
  for(const token of ['academicYear','term','allowLateSubmissions','publishedAt','publishedBy','closedAt','closedBy','archivedAt','archivedBy','revision','migrationQuarantinedAt','migrationQuarantineReason'])assert.ok(src.includes(token),token);
});

test('AssignmentSubmission model has audit fields and partial active assignment/student uniqueness',()=>{
  const src=read('src/models/tenant/AssignmentSubmission.js');
  for(const token of ['submittedAt','lastSubmittedAt','revision','isLate','gradedAt','gradedBy','gradeRevision','reopenedAt','migrationQuarantinedAt'])assert.ok(src.includes(token),token);
  assert.match(src,/name: "uniq_active_assignment_student_submission"/);
  assert.match(src,/partialFilterExpression: \{ migrationQuarantinedAt: null \}/);
});

test('Assignment publish/update and grade flows synchronize targeted notifications',()=>{
  const src=read('src/controllers/tenant/admin/assignmentController.js');
  assert.match(src,/assignmentTargetStudentFilter\(assignment\)/);
  assert.match(src,/entityType:"assignment"/);
  assert.match(src,/entityType:"assignment_submission"/);
  assert.match(src,/notifyGrade/);
});

test('Student attachment evidence is restricted to safe HTTP(S) URLs before rendering',()=>{
  const src=read('src/controllers/tenant/students/assignmentsController.js');
  assert.match(src,/normalizeUrlList/);
  assert.match(src,/\.map\(safeHttpUrl\)\.filter\(Boolean\)/);
  const view=read('views/students/assignment-detail.ejs');
  assert.match(view,/rel="noopener noreferrer"/);
});

test('Assignment due dates are interpreted in tenant timezone and serialized back to local input',()=>{
  const ctrl=read('src/controllers/tenant/admin/assignmentController.js');
  assert.match(ctrl,/normalizeDueDateInput\(req\.body\.dueDate,req\.tenant\?\.timezone\|\|"UTC"\)/);
  assert.match(ctrl,/formatDateTimeLocal\(a\.dueDate,timezone\)/);
});

test('Assignment migration is exposed and runs after Transcripts before tenant index creation',()=>{
  const pkg=JSON.parse(read('package.json')); assert.equal(pkg.scripts['migrate:assignments'],'node scripts/migrate-assignments.js');
  const src=read('scripts/create-indexes.js'); const transcripts=src.indexOf('migrateTranscripts(tenantModels)'); const assignments=src.indexOf('migrateAssignments(tenantModels)'); const indexes=src.indexOf('createModelIndexes(label, tenantModels)'); assert.ok(transcripts>=0&&assignments>transcripts&&indexes>assignments);
});

test('Assignment migration normalizes legacy identity/status and quarantines duplicate submissions before unique index',()=>{
  const src=read('scripts/lib/migrateAssignments.js');
  for(const token of ['legacyAssignmentStatus','legacySubmissionStatus','courseId','studentId','duplicatesQuarantined','dropConflictingSubmissionIndexes','ensureSubmissionIndex','migrationQuarantinedAt'])assert.ok(src.includes(token),token);
});

test('Admin and Student assignment templates compile',()=>{
  for(const rel of ['views/tenant/assignments/index.ejs','views/tenant/assignments/submissions.ejs','views/students/assignments.ejs','views/students/assignment-detail.ejs']){const file=path.join(root,rel);assert.doesNotThrow(()=>ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}),rel);}
});


test('Parent Assignments fail closed on Student, Assignment, AssignmentSubmission and Subject together',()=>{
  const src=read('src/routes/tenant/parents/index.js');
  assert.match(src,/requireTenantModels\(\["Student", "Assignment", "AssignmentSubmission", "Subject"\], \{ match: "all" \}\), require\("\.\/assignments"\)/);
});

test('Parent Assignments are read-only and reuse the canonical Student academic visibility contract',()=>{
  const route=read('src/routes/tenant/parents/assignments.js');
  const ctrl=read('src/controllers/tenant/parents/assignmentsController.js');
  assert.match(route,/router\.get\("\/assignments"/);
  assert.doesNotMatch(route,/router\.(post|put|patch|delete)\(/);
  assert.match(ctrl,/assignmentVisibilityFilterForStudent\(student\)/);
  assert.match(ctrl,/canAccessChild\(parent, student\._id\)/);
  assert.match(ctrl,/migrationQuarantinedAt: null/);
});

test('Parent Assignment rows expose status and grade but not submission body/evidence',()=>{
  const ctrl=read('src/controllers/tenant/parents/assignmentsController.js');
  const body=ctrl.slice(ctrl.indexOf('function assignmentRow'),ctrl.indexOf('module.exports'));
  assert.match(body,/submissionStatus/);
  assert.match(body,/feedback/);
  assert.match(body,/percentage/);
  assert.doesNotMatch(body,/attachmentUrls/);
  assert.doesNotMatch(body,/submission\?\.text/);
});

test('Parent Assignment template compiles and navigation is model-gated',()=>{
  const file=path.join(root,'views/parents/assignments.ejs');
  ejs.compile(fs.readFileSync(file,'utf8'),{filename:file});
  const nav=read('views/parents/navbar.ejs');
  assert.match(nav,/showAssignments = modelSet\.has\("Assignment"\) && modelSet\.has\("AssignmentSubmission"\)/);
  assert.match(nav,/href: "\/parent\/assignments"/);
});
