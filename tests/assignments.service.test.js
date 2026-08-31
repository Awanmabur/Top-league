const test = require('node:test');
const assert = require('node:assert/strict');
const {
  csvCell,
  safeHttpUrl,
  normalizeUrlList,
  normalizeDueDateInput,
  assertSubjectMatchesScope,
  assignmentTargetStudentFilter,
  assertStudentMatchesAssignmentScope,
  assignmentVisibilityFilterForStudent,
  structuralChanged,
  assertAssignmentEditable,
  assertAssignmentDeleteAllowed,
  assignmentStatusUpdate,
  assertSubmissionAllowed,
  buildStudentSubmissionValues,
  withdrawSubmissionUpdate,
  gradeSubmissionUpdate,
  reopenSubmissionUpdate,
} = require('../src/services/tenant/assignmentService');

const assignment = {
  _id: '507f1f77bcf86cd799439011', status: 'published', classGroup: '507f1f77bcf86cd799439012',
  sectionId: null, streamId: null, academicYear: '2026', term: 2, totalPoints: 50,
  dueDate: new Date('2026-09-10T09:00:00Z'), allowLateSubmissions: false,
};
const student = {
  _id: '507f1f77bcf86cd799439013', userId: '507f1f77bcf86cd799439014', status: 'active', isDeleted: false,
  classId: '507f1f77bcf86cd799439012', sectionId: '', streamId: '', academicYear: '2026', term: 2,
};

test('formula-like CSV cells are neutralized', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(' normal '), '" normal "');
});

test('attachment URLs allow only http/https and deduplicate', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a');
  assert.deepEqual(normalizeUrlList(['https://example.com/a','https://example.com/a','ftp://bad/file']), ['https://example.com/a']);
});

test('tenant-local due date parsing preserves the intended Kampala wall clock', () => {
  assert.equal(normalizeDueDateInput('2026-08-30T08:15', 'Africa/Kampala').toISOString(), '2026-08-30T05:15:00.000Z');
});



test('date-only assignment deadlines mean end of tenant-local day',()=>{
  const due=normalizeDueDateInput('2026-09-05','Africa/Kampala');
  assert.equal(due.toISOString(),'2026-09-05T20:59:00.000Z');
});

test('subject must belong to the selected academic scope', () => {
  const subject={status:'active',classId:'c1',sectionId:'s1',academicYear:'2026',term:2};
  assert.doesNotThrow(()=>assertSubjectMatchesScope(subject,{classId:'c1',sectionId:'s1',academicYear:'2026',term:2}));
  assert.throws(()=>assertSubjectMatchesScope(subject,{classId:'c2',sectionId:'s1',academicYear:'2026',term:2}),/does not belong/);
  assert.throws(()=>assertSubjectMatchesScope(subject,{classId:'c1',sectionId:null,academicYear:'2026',term:2}),/section-specific/);
});

test('assignment target and Student visibility filters are canonical academic scope filters', () => {
  assert.deepEqual(assignmentTargetStudentFilter(assignment), {isDeleted:{$ne:true},status:'active',classId:'507f1f77bcf86cd799439012',academicYear:'2026',term:2});
  const filter=assignmentVisibilityFilterForStudent(student);
  assert.deepEqual(filter.status,{$in:['published','closed']});
  assert.equal(String(filter.classGroup),student.classId);
  assert.equal(filter.migrationQuarantinedAt,null);
});

test('student assignment scope rejects cross-class/year/term access', () => {
  assert.doesNotThrow(()=>assertStudentMatchesAssignmentScope(student,assignment));
  assert.throws(()=>assertStudentMatchesAssignmentScope({...student,classId:'other'},assignment),/not assigned/);
  assert.throws(()=>assertStudentMatchesAssignmentScope({...student,academicYear:'2025'},assignment),/different academic year/);
  assert.throws(()=>assertStudentMatchesAssignmentScope({...student,term:1},assignment),/different term/);
});

test('structural assignment fields lock after first submission', () => {
  assert.equal(structuralChanged(assignment,{...assignment,title:'Changed'}),false);
  assert.equal(structuralChanged(assignment,{...assignment,totalPoints:60}),true);
  assert.throws(()=>assertAssignmentEditable(assignment,{...assignment,totalPoints:60},1),/locked after the first student submission/);
  assert.doesNotThrow(()=>assertAssignmentEditable(assignment,{...assignment,title:'Changed'},1));
});

test('delete is draft-only and blocked after any submission', () => {
  assert.doesNotThrow(()=>assertAssignmentDeleteAllowed({...assignment,status:'draft'},0));
  assert.throws(()=>assertAssignmentDeleteAllowed({...assignment,status:'published'},0),/Only Draft/);
  assert.throws(()=>assertAssignmentDeleteAllowed({...assignment,status:'draft'},1),/retained for audit/);
});

test('assignment lifecycle prevents unsafe unpublish after submissions and requires close/archive order', () => {
  assert.equal(assignmentStatusUpdate({...assignment,status:'draft'},'published','u1',0).status,'published');
  assert.throws(()=>assignmentStatusUpdate(assignment,'draft','u1',2),/cannot be unpublished/);
  assert.equal(assignmentStatusUpdate(assignment,'closed','u1',2).status,'closed');
  assert.equal(assignmentStatusUpdate({...assignment,status:'closed'},'archived','u1',2).status,'archived');
  assert.throws(()=>assignmentStatusUpdate({...assignment,status:'archived'},'published','u1',0),/cannot move/);
});

test('student submission requires published assignment and respects deadline', () => {
  assert.doesNotThrow(()=>assertSubmissionAllowed(assignment,student,null,new Date('2026-09-01T00:00:00Z')));
  assert.throws(()=>assertSubmissionAllowed({...assignment,status:'closed'},student,null,new Date('2026-09-01T00:00:00Z')),/not open/);
  assert.throws(()=>assertSubmissionAllowed(assignment,student,null,new Date('2026-09-11T00:00:00Z')),/deadline has passed/);
  assert.doesNotThrow(()=>assertSubmissionAllowed({...assignment,allowLateSubmissions:true},student,null,new Date('2026-09-11T00:00:00Z')));
});

test('student submission requires content and increments resubmission revision', () => {
  const first=buildStudentSubmissionValues({assignment,student,text:' My answer ',attachmentUrls:['https://example.com/file'],now:new Date('2026-09-01T00:00:00Z')});
  assert.equal(first.status,'submitted'); assert.equal(first.revision,0); assert.equal(first.text,'My answer'); assert.equal(first.isLate,false);
  const second=buildStudentSubmissionValues({assignment,student,current:{...first,submittedAt:first.submittedAt},text:'Revision',now:new Date('2026-09-02T00:00:00Z')});
  assert.equal(second.revision,1);
  assert.throws(()=>buildStudentSubmissionValues({assignment,student,text:'',attachmentUrls:['javascript:bad'],now:new Date('2026-09-01T00:00:00Z')}),/Add submission text/);
});

test('graded submissions are locked until Admin reopens them', () => {
  const submitted={status:'submitted',gradeRevision:0};
  const graded=gradeSubmissionUpdate(submitted,assignment,45,'Good','admin',new Date());
  assert.equal(graded.status,'graded'); assert.equal(graded.percentage,90); assert.equal(graded.gradeRevision,1);
  assert.throws(()=>gradeSubmissionUpdate({status:'graded'},assignment,40,'','admin'),/Only submitted/);
  assert.throws(()=>gradeSubmissionUpdate(submitted,assignment,51,'','admin'),/between 0 and 50/);
  const reopened=reopenSubmissionUpdate({status:'graded'},'admin',new Date());
  assert.equal(reopened.status,'submitted'); assert.equal(reopened.score,null); assert.equal(reopened.feedback,'');
});

test('only an ungraded submitted record can be withdrawn', () => {
  assert.equal(withdrawSubmissionUpdate({status:'submitted'},'student').status,'draft');
  assert.throws(()=>withdrawSubmissionUpdate({status:'graded'},'student'),/Only a submitted/);
});

const { legacyAssignmentStatus, legacySubmissionStatus, migrateAssignments } = require('../scripts/lib/migrateAssignments');

test('legacy assignment and submission statuses normalize conservatively', () => {
  assert.equal(legacyAssignmentStatus({status:'Open'}),'published');
  assert.equal(legacyAssignmentStatus({status:'completed'}),'closed');
  assert.equal(legacyAssignmentStatus({status:'pending'}),'draft');
  assert.equal(legacySubmissionStatus({status:'turned_in'}),'submitted');
  assert.equal(legacySubmissionStatus({mark: 8}),'graded');
});

class FakeCollection {
  constructor(rows=[],indexes=[]){this.rows=rows.map((r)=>({...r}));this._indexes=indexes.map((i)=>({...i}));this.dropped=[];this.created=[];}
  find(){return{toArray:async()=>this.rows.map((r)=>({...r}))};}
  async updateOne(filter,update){const row=this.rows.find((r)=>String(r._id)===String(filter._id));if(!row)return{matchedCount:0};Object.assign(row,update.$set||{});return{matchedCount:1};}
  async indexes(){return this._indexes.map((i)=>({...i}));}
  async dropIndex(name){this.dropped.push(name);this._indexes=this._indexes.filter((i)=>i.name!==name);}
  async createIndex(key,options){this.created.push({key:{...key},options:{...options}});return options.name;}
}

test('assignment migration repairs canonical scope and quarantines unresolved legacy assignments', async () => {
  const classId='65f111111111111111111111', subjectId='65f222222222222222222222', studentId='65f333333333333333333333';
  const acol=new FakeCollection([
    {_id:'a1',name:'Math HW',courseId:subjectId,classId,deadline:new Date('2026-09-01T10:00:00Z'),marks:20,status:'open'},
    {_id:'a2',name:'Broken',courseId:'missing',classId:'missing',status:'open'},
  ]);
  const scol=new FakeCollection([],[{name:'assignment_1_student_1',key:{assignment:1,student:1},unique:true}]);
  const models={
    Assignment:{collection:acol}, AssignmentSubmission:{collection:scol},
    Subject:{collection:new FakeCollection([{_id:subjectId,code:'MTH',title:'Mathematics',classId,academicYear:'2026',term:2,status:'active'}])},
    Class:{collection:new FakeCollection([{_id:classId,name:'S2',academicYear:'2026',term:2}])},
    Student:{collection:new FakeCollection([{_id:studentId,status:'active'}])},
  };
  const stats=await migrateAssignments(models);
  assert.equal(stats.assignmentsScanned,2); assert.equal(stats.assignmentsQuarantined,1);
  const good=acol.rows.find((r)=>r._id==='a1'), bad=acol.rows.find((r)=>r._id==='a2');
  assert.equal(String(good.course),subjectId); assert.equal(String(good.classGroup),classId); assert.equal(good.academicYear,'2026'); assert.equal(good.term,2); assert.equal(good.totalPoints,20); assert.equal(good.status,'published'); assert.equal(good.migrationQuarantinedAt,null);
  assert.equal(bad.status,'archived'); assert.ok(bad.migrationQuarantinedAt);
  assert.deepEqual(scol.dropped,['assignment_1_student_1']); assert.equal(scol.created[0].options.name,'uniq_active_assignment_student_submission');
});

test('assignment migration keeps strongest duplicate student submission and quarantines the other', async () => {
  const classId='65f111111111111111111111', subjectId='65f222222222222222222222', studentId='65f333333333333333333333', assignmentId='65f444444444444444444444';
  const acol=new FakeCollection([{_id:assignmentId,title:'Essay',course:subjectId,classGroup:classId,totalPoints:50,status:'published',academicYear:'2026',term:1}]);
  const subcol=new FakeCollection([
    {_id:'s1',assignmentId,studentId,status:'submitted',submittedAt:new Date('2026-08-20')},
    {_id:'s2',assignmentId,studentId,status:'graded',score:45,gradedAt:new Date('2026-08-22'),updatedAt:new Date('2026-08-22')},
  ]);
  const stats=await migrateAssignments({Assignment:{collection:acol},AssignmentSubmission:{collection:subcol},Subject:{collection:new FakeCollection([{_id:subjectId,title:'English',code:'ENG',classId,academicYear:'2026',term:1,status:'active'}])},Class:{collection:new FakeCollection([{_id:classId,name:'S1',academicYear:'2026',term:1}])},Student:{collection:new FakeCollection([{_id:studentId,status:'active'}])}});
  assert.equal(stats.duplicateGroups,1); assert.equal(stats.duplicatesQuarantined,1); assert.equal(subcol.rows.filter((r)=>!r.migrationQuarantinedAt).length,1);
  const kept=subcol.rows.find((r)=>!r.migrationQuarantinedAt); assert.equal(kept.status,'graded'); assert.equal(kept.score,45); assert.equal(kept.percentage,90);
});
