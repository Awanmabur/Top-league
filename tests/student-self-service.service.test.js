const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const svc = require('../src/services/tenant/studentSelfServiceService');

const student={_id:'64b000000000000000000001',status:'active',classId:'class-1',classLevel:'S4',sectionId:'sec-a',streamId:'stream-a',academicYear:'2026',term:2};
const subject={_id:'64b000000000000000000002',status:'active',classId:'class-1',sectionId:'sec-a',streamId:'stream-a',academicYear:'2026',term:2,isCompulsory:false};

test('subject availability enforces current academic scope',()=>{
  assert.equal(svc.subjectMatchesStudent(subject,student),true);
  assert.equal(svc.subjectMatchesStudent({...subject,classId:'class-2'},student),false);
  assert.equal(svc.subjectMatchesStudent({...subject,term:1},student),false);
  assert.equal(svc.subjectMatchesStudent({...subject,sectionId:'sec-b'},student),false);
});

test('subject without class id or level fails closed',()=>{
  assert.equal(svc.subjectMatchesStudent({...subject,classId:'',classLevel:''},student),false);
});

test('registration window requires open status and current time range',()=>{
  const now=new Date('2026-08-30T06:00:00Z');
  const win={status:'open',academicYear:'2026',term:2,classLevel:'S4',opensAt:new Date('2026-08-29'),closesAt:new Date('2026-09-01')};
  assert.equal(svc.windowMatchesStudent(win,student,now),true);
  assert.equal(svc.windowMatchesStudent({...win,status:'draft'},student,now),false);
  assert.equal(svc.windowMatchesStudent({...win,closesAt:new Date('2026-08-29')},student,now),false);
});

test('most specific matching registration window wins',()=>{
  const now=new Date('2026-08-30T06:00:00Z');
  const base={status:'open',academicYear:'2026',term:2,opensAt:new Date('2026-08-29'),closesAt:new Date('2026-09-01')};
  const picked=svc.pickActiveRegistrationWindow([{...base,name:'all'},{...base,name:'class',classLevel:'S4'},{...base,name:'stream',classLevel:'S4',streamId:'stream-a'}],student,now);
  assert.equal(picked.name,'stream');
});

test('external apply URLs allow HTTP(S) only',()=>{
  assert.match(svc.safeExternalUrl('https://example.test/apply'),/^https:/);
  assert.equal(svc.safeExternalUrl('javascript:alert(1)'), '');
  assert.equal(svc.safeExternalUrl('data:text/html,x'), '');
});

test('job visibility requires Published, current window and eligible class',()=>{
  const now=new Date('2026-08-30T06:00:00Z');
  const job={status:'Published',publishAt:new Date('2026-08-29'),deadline:new Date('2026-09-01'),eligibleClassLevels:['S4']};
  assert.equal(svc.jobVisibleToStudent(job,student,now),true);
  assert.equal(svc.jobVisibleToStudent({...job,status:'Draft'},student,now),false);
  assert.equal(svc.jobVisibleToStudent({...job,eligibleClassLevels:['S6']},student,now),false);
  assert.equal(svc.jobVisibleToStudent({...job,deadline:new Date('2026-08-29')},student,now),false);
});

test('job transition rejects illegal lifecycle jumps',async()=>{
  const Job={findOne(){return {lean:async()=>({_id:student._id,status:'Draft',revision:1})}},findOneAndUpdate:async()=>({})};
  await assert.rejects(()=>svc.transitionJob(Job,{id:student._id,revision:1,status:'Closed'}),/cannot move/);
});

test('job transition is revision guarded',async()=>{
  const Job={findOne(){return {lean:async()=>({_id:student._id,status:'Draft',revision:2})}},findOneAndUpdate:async()=>({})};
  await assert.rejects(()=>svc.transitionJob(Job,{id:student._id,revision:1,status:'Published'}),/changed in another session/);
});

test('application withdrawal is owner-scoped and revision guarded',async()=>{
  let filter;
  const App={findOne(){return {lean:async()=>({_id:subject._id,studentId:student._id,status:'Submitted',revision:3})}},async findOneAndUpdate(q){filter=q;return {_id:subject._id,status:'Withdrawn'}}};
  await svc.withdrawJobApplication(App,{student,applicationId:subject._id,userId:student._id});
  assert.equal(String(filter.studentId),student._id); assert.equal(filter.revision,3); assert.equal(filter.status,'Submitted');
});

test('letter request numbers are unpredictable-looking and date scoped',()=>{
  const n=svc.newLetterRequestNumber(new Date('2026-08-30T00:00:00Z'),()=>Buffer.from('0102030405','hex'));
  assert.equal(n,'CA-LTR-20260830-0102030405');
});

test('official letter signing and verification use HMAC credential',()=>{
  const secret='x'.repeat(40); const letter={requestNumber:'CA-LTR-1',studentId:student._id,type:'Registration Letter',status:'Ready',readyAt:new Date('2026-08-30T06:00:00Z'),issuedSnapshot:{studentName:'Test Student',registrationNumber:'S-1',classLevel:'S4',academicYear:'2026',term:2,purpose:'Visa'}};
  const sig=svc.signLetterCredential(letter,secret);
  assert.equal(sig.length,64); assert.deepEqual(svc.verifyLetterCredential(letter,sig,secret),{ok:true});
  assert.match(svc.verifyLetterCredential(letter,'0'.repeat(64),secret).reason,/Invalid/);
});

test('letters that are not Ready or Collected cannot verify',()=>{
  const secret='y'.repeat(40); const letter={requestNumber:'X',studentId:student._id,type:'Admission Letter',status:'Approved',readyAt:null};
  assert.equal(svc.verifyLetterCredential(letter,'x',secret).ok,false);
});

test('document signing fails closed when secret is too short',()=>{
  const old1=process.env.DOCUMENT_SIGNING_SECRET, old2=process.env.TRANSCRIPT_SIGNING_SECRET;
  try { process.env.DOCUMENT_SIGNING_SECRET='short'; delete process.env.TRANSCRIPT_SIGNING_SECRET; assert.throws(()=>svc.assertDocumentSigningConfigured(),/at least 32 bytes/); }
  finally { if(old1===undefined) delete process.env.DOCUMENT_SIGNING_SECRET; else process.env.DOCUMENT_SIGNING_SECRET=old1; if(old2===undefined) delete process.env.TRANSCRIPT_SIGNING_SECRET; else process.env.TRANSCRIPT_SIGNING_SECRET=old2; }
});

test('student self-service lease uses cryptographic token and active-student filter',async()=>{
  let query, update;
  const Student={findOneAndUpdate(q,u){query=q;update=u;return {lean:async()=>({...student,selfServiceLeaseToken:u.$set.selfServiceLeaseToken})}}};
  const out=await svc.claimStudentSelfServiceLease(Student,{studentId:student._id,actorUserId:student._id,now:new Date()});
  assert.equal(query.status,'active'); assert.equal(query.isDeleted.$ne,true); assert.equal(update.$set.selfServiceLeaseToken.length,36); assert.equal(out.token.length,36);
});

test('student self-service lease release is token-scoped',async()=>{
  let q,u; const Student={updateOne:async(a,b)=>(q=a,u=b,{})};
  await svc.releaseStudentSelfServiceLease(Student,{studentId:student._id,token:'abc'});
  assert.equal(q.selfServiceLeaseToken,'abc'); assert.equal(u.$set.selfServiceLeaseToken,'');
});

test('letter transition only follows registry lifecycle',async()=>{
  const Letter={findOne(){return {lean:async()=>({_id:student._id,status:'Pending',revision:1})}},findOneAndUpdate:async()=>({})};
  await assert.rejects(()=>svc.transitionLetterRequest(Letter,{id:student._id,revision:1,status:'Ready'}),/cannot move/);
});

test('Ready letter transition requires immutable issuance snapshot',async()=>{
  const Letter={findOne(){return {lean:async()=>({_id:student._id,status:'Approved',revision:1,academicYear:'2026',term:2,purpose:'Visa'})}},findOneAndUpdate:async()=>({})};
  await assert.rejects(()=>svc.transitionLetterRequest(Letter,{id:student._id,revision:1,status:'Ready'}),/identity snapshot/);
});

test('letter signature changes when frozen issuance data changes',()=>{
  const secret='z'.repeat(40); const base={requestNumber:'CA-LTR-X',studentId:student._id,type:'Bonafide Student Letter',status:'Ready',readyAt:new Date('2026-08-30'),issuedSnapshot:{studentName:'A Student',registrationNumber:'R1',classLevel:'S4',academicYear:'2026',term:2,purpose:'Visa'}};
  assert.notEqual(svc.signLetterCredential(base,secret),svc.signLetterCredential({...base,issuedSnapshot:{...base.issuedSnapshot,classLevel:'S5'}},secret));
});
