const test = require('node:test');
const assert = require('node:assert/strict');
const {
  csvCell, normalizeAttendanceStatus, isAttendedStatus, attendanceSummary,
  parseTenantDateTime, dateKeyInTimezone, attendanceDateFromSession,
  attendanceStudentFilter, assertStudentMatchesAttendanceScope,
  assertSubjectMatchesAttendanceScope, buildAttendanceValues,
  attendanceCorrectionEntry, softDeleteAttendanceUpdate, studentAttendanceFilter,
} = require('../src/services/tenant/attendanceService');

const ids={student:'507f1f77bcf86cd799439001',subject:'507f1f77bcf86cd799439002',class:'507f1f77bcf86cd799439003',section:'507f1f77bcf86cd799439004',stream:'507f1f77bcf86cd799439005'};
const student={_id:ids.student,status:'active',isDeleted:false,classId:ids.class,sectionId:ids.section,streamId:ids.stream,academicYear:'2026',term:2};
const subject={_id:ids.subject,status:'active',classId:ids.class,sectionId:ids.section,streamId:ids.stream,academicYear:'2026',term:2};
const scope={classGroup:ids.class,sectionId:ids.section,streamId:ids.stream,sectionName:'A',streamName:'Blue',academicYear:'2026',term:2};

test('normalizes attendance aliases and rejects unknown status',()=>{
  assert.equal(normalizeAttendanceStatus('P'),'present'); assert.equal(normalizeAttendanceStatus('missed'),'absent'); assert.equal(normalizeAttendanceStatus('tardy'),'late'); assert.equal(normalizeAttendanceStatus('authorized'),'excused');
  assert.throws(()=>normalizeAttendanceStatus('remote'),/Invalid attendance status/);
});
test('attendance rate counts present late and excused consistently',()=>{
  const s=attendanceSummary([{status:'present'},{status:'late'},{status:'excused'},{status:'absent'},{status:'present',isDeleted:true}]);
  assert.deepEqual(s,{total:4,present:1,absent:1,late:1,excused:1,attended:3,rate:75});
  assert.equal(isAttendedStatus('late'),true); assert.equal(isAttendedStatus('absent'),false);
});
test('tenant datetime parsing preserves local clock and day key',()=>{
  const d=parseTenantDateTime('2026-08-29T08:30','Africa/Kampala');
  assert.equal(d.toISOString(),'2026-08-29T05:30:00.000Z'); assert.equal(dateKeyInTimezone(d,'Africa/Kampala'),'2026-08-29');
  assert.equal(attendanceDateFromSession(d,'Africa/Kampala').toISOString(),'2026-08-29T00:00:00.000Z');
});
test('invalid tenant timezone/date fail closed',()=>{
  assert.throws(()=>parseTenantDateTime('bad','Africa/Kampala'),/Invalid session/);
  assert.throws(()=>parseTenantDateTime('2026-08-29T08:30','Bad\/Zone'),/timezone/);
});
test('student filter follows complete class section stream year term scope',()=>{
  assert.deepEqual(attendanceStudentFilter(scope),{isDeleted:{$ne:true},status:'active',classId:ids.class,sectionId:ids.section,streamId:ids.stream,academicYear:'2026',term:2});
});
test('student must belong to exact attendance scope',()=>{
  assert.doesNotThrow(()=>assertStudentMatchesAttendanceScope(student,scope));
  assert.throws(()=>assertStudentMatchesAttendanceScope({...student,classId:'507f1f77bcf86cd799439099'},scope),/selected class/);
  assert.throws(()=>assertStudentMatchesAttendanceScope({...student,status:'suspended'},scope),/Only active students/);
});
test('subject must be active and match academic scope',()=>{
  assert.doesNotThrow(()=>assertSubjectMatchesAttendanceScope(subject,scope));
  assert.throws(()=>assertSubjectMatchesAttendanceScope({...subject,status:'archived'},scope),/active subject/);
  assert.throws(()=>assertSubjectMatchesAttendanceScope({...subject,streamId:'507f1f77bcf86cd799439099'},scope),/selected stream/);
});
test('section-specific subject requires section',()=>{
  assert.throws(()=>assertSubjectMatchesAttendanceScope(subject,{...scope,sectionId:null}),/section-specific/);
});
test('new attendance builds canonical timezone-aware values',()=>{
  const v=buildAttendanceValues({student,subject,scope,sessionAt:'2026-08-29T08:30',status:'A',notes:'  Sick  ',timezone:'Africa/Kampala',actorId:'507f1f77bcf86cd799439010'});
  assert.equal(String(v.student),ids.student); assert.equal(String(v.subject),ids.subject); assert.equal(v.status,'absent'); assert.equal(v.notes,'Sick'); assert.equal(v.sessionAt.toISOString(),'2026-08-29T05:30:00.000Z'); assert.equal(v.attendanceDate.toISOString(),'2026-08-29T00:00:00.000Z'); assert.equal(v.revision,0);
});
test('correction increments revision and records reason',()=>{
  const current={...buildAttendanceValues({student,subject,scope,sessionAt:'2026-08-29T08:30',status:'absent',timezone:'Africa/Kampala'}),revision:3};
  const v=buildAttendanceValues({student,subject,scope,sessionAt:'2026-08-29T08:30',status:'present',timezone:'Africa/Kampala',current,correctionReason:'Teacher correction'});
  assert.equal(v.revision,4); assert.equal(v.lastCorrectionReason,'Teacher correction'); assert.ok(v.correctedAt instanceof Date);
});
test('correction entry preserves previous and next status',()=>{
  const e=attendanceCorrectionEntry({status:'absent',notes:'x',subject:ids.subject},{status:'present',notes:'y',subject:ids.subject},ids.student,'Register checked');
  assert.equal(e.fromStatus,'absent'); assert.equal(e.toStatus,'present'); assert.equal(e.reason,'Register checked');
});
test('soft deletion is audited and versioned',()=>{
  const u=softDeleteAttendanceUpdate({status:'present',revision:4,isDeleted:false},ids.student,'Duplicate entry');
  assert.equal(u.isDeleted,true); assert.equal(u.revision,5); assert.equal(u.deletionReason,'Duplicate entry');
});
test('already deleted or quarantined rows cannot be deleted through normal workflow',()=>{
  assert.throws(()=>softDeleteAttendanceUpdate({isDeleted:true}),/already archived/);
  assert.throws(()=>softDeleteAttendanceUpdate({isDeleted:false,migrationQuarantinedAt:new Date()}),/Quarantined/);
});
test('student visibility excludes deleted and quarantined rows',()=>{
  assert.deepEqual(studentAttendanceFilter(ids.student,{subject:ids.subject}),{student:ids.student,isDeleted:{$ne:true},migrationQuarantinedAt:null,subject:ids.subject});
});
test('CSV neutralizes spreadsheet formulas',()=>{
  assert.equal(csvCell('=2+2'),"\"'=2+2\""); assert.equal(csvCell(' @cmd'),"\"' @cmd\"");
});

const { migrateAttendance, legacyStatus } = require('../scripts/lib/migrateAttendance');
class FakeCollection {
  constructor(rows=[],indexes=[]){this.rows=rows.map((r)=>({...r}));this._indexes=indexes.map((i)=>({...i}));this.dropped=[];this.created=[];}
  find(){return{toArray:async()=>this.rows.map((r)=>({...r}))};}
  async updateOne(filter,update){const row=this.rows.find((r)=>String(r._id)===String(filter._id));if(!row)return{matchedCount:0};Object.assign(row,update.$set||{});return{matchedCount:1};}
  async indexes(){return this._indexes.map((i)=>({...i}));}
  async dropIndex(name){this.dropped.push(name);this._indexes=this._indexes.filter((i)=>i.name!==name);}
  async createIndex(key,options){this.created.push({key:{...key},options:{...options}});return options.name;}
}

test('legacy status mapping is conservative',()=>{assert.equal(legacyStatus({attendanceStatus:'P'}),'present');assert.equal(legacyStatus({state:'missed'}),'absent');assert.equal(legacyStatus({status:'unknown'}),null);});

test('attendance migration repairs canonical legacy links and rebuilds partial unique index',async()=>{
  const studentId='65f111111111111111111111',subjectId='65f222222222222222222222',classId='65f333333333333333333333',sectionId='65f444444444444444444444',streamId='65f555555555555555555555';
  const acol=new FakeCollection([{_id:'r1',studentId,courseId:subjectId,classId,sectionId,streamId,date:new Date('2026-08-29T05:30:00Z'),attendanceStatus:'P',remark:'ok'}],[{name:'student_1_subject_1_sessionAt_1_isDeleted_1',key:{student:1,subject:1,sessionAt:1,isDeleted:1},unique:true}]);
  const models={Attendance:{collection:acol},Student:{collection:new FakeCollection([{_id:studentId,regNo:'R1',classId,sectionId,streamId,academicYear:'2026',term:2,status:'active'}])},Subject:{collection:new FakeCollection([{_id:subjectId,code:'MTH',classId,sectionId,streamId,academicYear:'2026',term:2,status:'active'}])},Class:{collection:new FakeCollection([{_id:classId,academicYear:'2026',term:2}])},Section:{collection:new FakeCollection([{_id:sectionId,classId,name:'A'}])},Stream:{collection:new FakeCollection([{_id:streamId,classId,sectionId,name:'Blue'}])}};
  const stats=await migrateAttendance(models,{timezone:'Africa/Kampala'});const row=acol.rows[0];assert.equal(stats.scanned,1);assert.equal(stats.quarantined,0);assert.equal(String(row.student),studentId);assert.equal(String(row.subject),subjectId);assert.equal(String(row.classGroup),classId);assert.equal(row.status,'present');assert.equal(row.attendanceDate.toISOString(),'2026-08-29T00:00:00.000Z');assert.deepEqual(acol.dropped,['student_1_subject_1_sessionAt_1_isDeleted_1']);assert.equal(acol.created[0].options.name,'uniq_active_attendance_student_subject_session');
});

test('attendance migration quarantines unresolved rows and weaker duplicates',async()=>{
  const studentId='65f111111111111111111111',subjectId='65f222222222222222222222',classId='65f333333333333333333333';const session=new Date('2026-08-29T05:30:00Z');
  const acol=new FakeCollection([{_id:'a1',student:studentId,subject:subjectId,classGroup:classId,sessionAt:session,status:'present',revision:1,updatedAt:new Date('2026-08-29')},{_id:'a2',student:studentId,subject:subjectId,classGroup:classId,sessionAt:session,status:'absent',revision:3,updatedAt:new Date('2026-08-30')},{_id:'bad',studentId:'missing',courseId:'missing',date:'bad',status:'x'}]);
  const models={Attendance:{collection:acol},Student:{collection:new FakeCollection([{_id:studentId,classId,academicYear:'2026',term:1,status:'active'}])},Subject:{collection:new FakeCollection([{_id:subjectId,code:'MTH',classId,academicYear:'2026',term:1,status:'active'}])},Class:{collection:new FakeCollection([{_id:classId,academicYear:'2026',term:1}])},Section:{collection:new FakeCollection([])},Stream:{collection:new FakeCollection([])}};
  const stats=await migrateAttendance(models,{timezone:'UTC'});assert.equal(stats.quarantined,1);assert.equal(stats.duplicateGroups,1);assert.equal(stats.duplicatesQuarantined,1);const active=acol.rows.filter((r)=>!r.migrationQuarantinedAt&&!r.isDeleted);assert.equal(active.length,1);assert.equal(active[0]._id,'a2');assert.ok(acol.rows.find((r)=>r._id==='bad').migrationQuarantinedAt);
});
