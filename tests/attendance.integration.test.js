const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const ejs=require('ejs');const root=path.resolve(__dirname,'..');const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('attendance mounts fail closed on complete canonical model sets',()=>{
  const admin=read('src/routes/tenant/admin/index.js'),student=read('src/routes/tenant/students/index.js'),parent=read('src/routes/tenant/parents/index.js');
  assert.match(admin,/\/attendance"[\s\S]*requireTenantModels\(\["Attendance", "Student", "Subject", "Class", "Section", "Stream", "Staff", "Notification", "Parent"\]/);
  assert.match(student,/\["Attendance", "Student", "Subject"\][\s\S]*require\("\.\/attendance"\)/);
  assert.match(parent,/\["Parent", "Student", "Attendance", "Subject"\][\s\S]*require\("\.\/attendance"\)/);
});

test('Attendance model has audit lifecycle and quarantine-aware active uniqueness',()=>{
  const src=read('src/models/tenant/Attendance.js');assert.match(src,/revision:/);assert.match(src,/corrections:/);assert.match(src,/migrationQuarantinedAt/);assert.match(src,/uniq_active_attendance_student_subject_session/);assert.match(src,/partialFilterExpression: \{ isDeleted: false, migrationQuarantinedAt: null \}/);
});

test('admin attendance mutations use revision compare-and-set and soft archive',()=>{
  const src=read('src/controllers/tenant/admin/attendanceController.js');assert.match(src,/revision:Number\(current\.revision\|\|0\)/);assert.match(src,/softDeleteAttendanceUpdate/);assert.match(src,/corrections:\{\$each:\[entry\],\$slice:-50\}/);assert.doesNotMatch(src,/Attendance\.deleteMany\(\{ _id: \{ \$in: ids \} \}/);
});

test('attendance alerts target student and parent identities and retire stale risk alerts',()=>{
  const src=read('src/controllers/tenant/admin/attendanceController.js');assert.match(src,/guardianUserId/);assert.match(src,/childrenStudentIds:studentId/);assert.match(src,/entityType:"attendance"/);assert.match(src,/\["absent","late"\]/);assert.match(src,/isDeleted:true,deletedAt:new Date\(\)/);
});

test('student attendance reads only canonical active records',()=>{
  const src=read('src/controllers/tenant/students/attendanceController.js');assert.match(src,/studentAttendanceFilter\(student\._id\)/);assert.match(src,/populate\(\{ path: "subject"/);assert.doesNotMatch(src,/studentId:/);assert.doesNotMatch(src,/sort\(\{ date:/);
});

test('student dashboard and subjects no longer use legacy attendance studentId reader',()=>{
  for(const f of ['src/controllers/tenant/students/dashboardController.js','src/controllers/tenant/students/subjectsController.js']){const src=read(f);assert.match(src,/studentAttendanceFilter\(student\._id\)/);assert.doesNotMatch(src,/Attendance\.find\(\{ studentId:/);}
});

test('parent attendance and child detail use canonical student ownership field only',()=>{
  for(const f of ['src/controllers/tenant/parents/attendanceController.js','src/controllers/tenant/parents/childViewsController.js']){const src=read(f);assert.match(src,/studentAttendanceFilter\(/);assert.doesNotMatch(src,/Attendance\.find\(\{[\s\S]{0,220}(?:studentId|\$or)/);}
});

test('student and parent attendance rate use one shared policy',()=>{
  assert.match(read('src/controllers/tenant/students/attendanceController.js'),/attendanceSummary/);assert.match(read('src/controllers/tenant/parents/attendanceController.js'),/attendanceSummary/);assert.match(read('src/controllers/tenant/students/dashboardController.js'),/attendanceSummary/);
});

test('admin attendance CSV export uses formula-safe cells',()=>{
  const src=read('src/controllers/tenant/admin/attendanceController.js');assert.match(src,/\.map\(csvCell\)\.join\(","\)/);assert.match(read('src/services/tenant/attendanceService.js'),/\[=\+\\-@\]/);
});

test('Admin attendance browser rendering has no database-backed innerHTML path',()=>{
  const src=read('public/js/attendance.js');assert.doesNotMatch(src,/innerHTML\s*=/);assert.match(src,/textContent=/);assert.match(src,/replaceChildren/);
});

test('attendance JSON bootstraps are RCDATA escaped',()=>{
  const src=read('views/tenant/attendance/index.ejs');const blocks=[...src.matchAll(/<textarea[^>]+class="json-data"[\s\S]*?<%-([\s\S]*?)%><\/textarea>/g)];assert.ok(blocks.length>=6);for(const m of blocks)assert.match(m[1],/replace\(\/<\/g, "\\\\u003c"\)/);
});

test('attendance sheet and student page use external CSP-safe scripts',()=>{
  const sheet=read('views/tenant/attendance/sheet.ejs'),student=read('views/students/attendance.ejs');assert.match(sheet,/\/js\/attendance-sheet\.js/);assert.doesNotMatch(sheet,/<script>\s*\(function/);assert.match(student,/\/js\/student-attendance\.js/);assert.doesNotMatch(student,/<script>\s*document\.getElementById/);
});

test('attendance migration is wired before tenant indexes',()=>{
  const pkg=JSON.parse(read('package.json'));assert.equal(pkg.scripts['migrate:attendance'],'node scripts/migrate-attendance.js');const src=read('scripts/create-indexes.js');const migration=src.indexOf('migrateAttendance(tenantModels');const indexes=src.indexOf('createModelIndexes(label, tenantModels)');assert.ok(migration>=0&&indexes>migration);
});

test('attendance migration normalizes, quarantines duplicates and replaces unique index',()=>{
  const src=read('scripts/lib/migrateAttendance.js');assert.match(src,/duplicatesQuarantined/);assert.match(src,/migrationQuarantinedAt/);assert.match(src,/dropConflictingIndexes/);assert.match(src,/uniq_active_attendance_student_subject_session/);
});

test('attendance views compile',()=>{for(const f of ['views/tenant/attendance/index.ejs','views/tenant/attendance/sheet.ejs','views/students/attendance.ejs','views/parents/attendance.ejs'])assert.doesNotThrow(()=>ejs.compile(read(f),{filename:path.join(root,f)}));});

test('attendance bulk actions use minimal canonical updates and compensated compare-and-set rollback',()=>{
  const src=read('src/controllers/tenant/admin/attendanceController.js');
  assert.match(src,/function bulkStatusValues/);
  assert.match(src,/restoreAttendanceSnapshot/);
  assert.match(src,/expectedRevision/);
  assert.doesNotMatch(src,/const values=\{\.\.\.row,status:next/);
});

test('cumulative admin JSON bootstraps use literal RCDATA unicode escapes',()=>{
  for(const file of ['views/tenant/attendance/index.ejs','views/tenant/assignments/index.ejs','views/tenant/transcripts/index.ejs','views/tenant/staff/leave.ejs','views/tenant/staff/payroll.ejs']){
    const src=read(file);
    assert.equal(src.includes('replace(/</g, "\\u003c")'),false,`${file}: unsafe one-backslash RCDATA escape`);
    assert.ok(src.includes('\\\\u003c'),`${file}: expected literal unicode RCDATA escape`);
  }
});

test('student Subjects reuses canonical Assignment and Exam visibility contracts',()=>{
  const src=read('src/controllers/tenant/students/subjectsController.js');
  assert.match(src,/Assignment\.find\(assignmentVisibilityFilterForStudent\(student\)\)/);
  assert.match(src,/Exam\.find\(studentExamFilter\(student\)\)/);
  assert.doesNotMatch(src,/assignedToStudents/);
  assert.doesNotMatch(src,/\{ programId: student\.programId/);
});
