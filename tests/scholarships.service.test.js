const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../src/services/tenant/scholarshipService');

test('public scholarship requires Active, non-student award and open date window', () => {
  const now = new Date('2026-08-29T12:00:00Z');
  assert.equal(svc.isPublicScholarship({ status:'Active', studentId:null, isDeleted:false, startDate:new Date('2026-08-01'), endDate:new Date('2026-09-01') }, now), true);
  assert.equal(svc.isPublicScholarship({ status:'Inactive', studentId:null }, now), false);
  assert.equal(svc.isPublicScholarship({ status:'Active', studentId:'507f1f77bcf86cd799439011' }, now), false);
  assert.equal(svc.isPublicScholarship({ status:'Active', studentId:null, endDate:new Date('2026-08-01') }, now), false);
});

test('public DTO maps canonical Scholarship fields rather than relying on a second schema', () => {
  const out = svc.toPublicScholarship({ name:'Merit', sponsor:'Fund', type:'Percentage', value:50, notes:'Strong results', startDate:new Date('2026-08-01'), endDate:new Date('2026-09-01'), programId:{ title:'Computer Science' } });
  assert.equal(out.title, 'Merit'); assert.equal(out.provider, 'Fund'); assert.equal(out.description, 'Strong results');
  assert.match(out.requirements.join(' '), /Computer Science/); assert.match(out.requirements.join(' '), /50%/);
});

test('applicant keys normalize identity and prefer student/reg number over contact data', () => {
  const id='507f1f77bcf86cd799439011';
  assert.equal(svc.applicantKey({ student:id, email:'A@B.COM' }), `student:${id}`);
  assert.equal(svc.applicantKey({ regNo:' cs / 1 ', email:'A@B.COM' }), 'reg:CS / 1');
  assert.equal(svc.applicantKey({ email:' A@B.COM ' }), 'email:a@b.com');
  assert.equal(svc.applicantKey({ phone:' +256 (700) 123-456 ' }), 'phone:+256700123456');
});

test('application lifecycle is controlled and terminal states cannot be reopened', () => {
  assert.doesNotThrow(() => svc.validateApplicationTransition('submitted','under_review'));
  assert.doesNotThrow(() => svc.validateApplicationTransition('under_review','shortlisted'));
  assert.doesNotThrow(() => svc.validateApplicationTransition('shortlisted','awarded'));
  assert.throws(() => svc.validateApplicationTransition('submitted','awarded'), /Cannot move/);
  assert.throws(() => svc.validateApplicationTransition('awarded','under_review'), /terminal/);
});

test('application status helper stamps lifecycle timestamps', () => {
  const app={status:'submitted'}; const now=new Date('2026-08-29T00:00:00Z');
  svc.applyApplicationStatus(app,'under_review','actor',now);
  assert.equal(app.status,'under_review'); assert.deepEqual(app.reviewedAt,now); assert.equal(app.reviewedBy,'actor');
});

test('document URLs allow only http and https', () => {
  assert.equal(svc.safeDocUrl('javascript:alert(1)'), '');
  assert.match(svc.safeDocUrl('https://example.com/a.pdf'), /^https:/);
});

test('file signature validation rejects MIME spoofing', () => {
  assert.doesNotThrow(()=>svc.assertFileSignature({mimetype:'application/pdf',originalname:'a.pdf',buffer:Buffer.from('%PDF-1.7')}));
  assert.throws(()=>svc.assertFileSignature({mimetype:'application/pdf',originalname:'a.pdf',buffer:Buffer.from('<html>')}), /does not match/);
  assert.doesNotThrow(()=>svc.assertFileSignature({mimetype:'image/png',originalname:'a.png',buffer:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1])}));
});

test('CSV cells neutralize spreadsheet formulas', () => {
  assert.equal(svc.csvCell('=2+2'), '"\'=2+2"');
  assert.equal(svc.csvCell('normal'), '"normal"');
});
