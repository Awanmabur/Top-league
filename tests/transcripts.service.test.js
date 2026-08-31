const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStatus,
  normalizeKind,
  normalizeRangeMode,
  normalizeRange,
  compareAcademicPoint,
  resultWithinRange,
  transcriptResultStatusFilter,
  assertTranscriptEditable,
  assertTranscriptDeleteAllowed,
  assertTranscriptIssueAllowed,
  assertTranscriptRevokeAllowed,
  hashSnapshot,
  snapshotIntegrityOk,
  verificationSignature,
  verifyTranscriptCredential,
  signPayload,
  legacyVerificationPayload,
  newIssueNumber,
  transcriptDisplaySnapshot,
  summarizePublishedResults,
} = require('../src/services/tenant/transcriptService');

const SECRET = 'x'.repeat(64);

test('transcript status/type/range modes normalize conservatively', () => {
  assert.equal(normalizeStatus('ISSUED'), 'issued');
  assert.equal(normalizeKind('unofficial'), 'unofficial');
  assert.equal(normalizeRangeMode('current_term'), 'current_term');
  assert.throws(() => normalizeStatus('published'), /Invalid transcript status/);
  assert.throws(() => normalizeKind('certificate'), /Invalid transcript type/);
});

test('custom transcript ranges compare academic year and term as one ordered point', () => {
  assert.deepEqual(normalizeRange({ academicYearFrom:'2025', termFrom:3, academicYearTo:'2026', termTo:1 }), {
    academicYearFrom:'2025', academicYearTo:'2026', termFrom:3, termTo:1,
  });
  assert.throws(() => normalizeRange({ academicYearFrom:'2026', termFrom:2, academicYearTo:'2026', termTo:1 }), /start period/);
  assert.ok(compareAcademicPoint('2025', 3, '2026', 1) < 0);
});

test('result range filtering handles cross-year boundary terms correctly', () => {
  const range = normalizeRange({ academicYearFrom:'2025', termFrom:3, academicYearTo:'2026', termTo:1 });
  assert.equal(resultWithinRange({ academicYear:'2025', term:2 }, range), false);
  assert.equal(resultWithinRange({ academicYear:'2025', term:3 }, range), true);
  assert.equal(resultWithinRange({ academicYear:'2026', term:1 }, range), true);
  assert.equal(resultWithinRange({ academicYear:'2026', term:2 }, range), false);
});

test('official transcript source is always published-only', () => {
  assert.equal(transcriptResultStatusFilter({ kind:'official', includeDraftResults:true }), 'published');
  assert.deepEqual(transcriptResultStatusFilter({ kind:'unofficial', includeDraftResults:true }), { $in:['draft','published'] });
  assert.equal(transcriptResultStatusFilter({ kind:'unofficial', includeDraftResults:true }, { issuing:true }), 'published');
});

test('issued and revoked transcripts are immutable', () => {
  assert.equal(assertTranscriptEditable({ status:'draft' }), true);
  assert.throws(() => assertTranscriptEditable({ status:'issued' }), /immutable/);
  assert.throws(() => assertTranscriptEditable({ status:'revoked' }), /immutable/);
});

test('permanent transcript delete is draft-only and never allowed after issuance', () => {
  assert.equal(assertTranscriptDeleteAllowed({ status:'draft' }), true);
  assert.throws(() => assertTranscriptDeleteAllowed({ status:'draft', issueNumber:'CA-TR-X' }), /retained for audit/);
  assert.throws(() => assertTranscriptDeleteAllowed({ status:'issued' }), /immutable/);
});

test('issuance requires published result provenance and no draft inclusion', () => {
  const live = { terms:[{ rows:[1] }], sourceResults:[{ id:'r1', status:'published' }] };
  assert.equal(assertTranscriptIssueAllowed({ status:'draft', includeDraftResults:false }, live), true);
  assert.throws(() => assertTranscriptIssueAllowed({ status:'draft', includeDraftResults:true }, live), /Draft results/);
  assert.throws(() => assertTranscriptIssueAllowed({ status:'draft' }, { terms:[], sourceResults:[] }), /no published results/);
  assert.throws(() => assertTranscriptIssueAllowed({ status:'draft' }, { terms:[{}], sourceResults:[{ status:'draft' }] }), /published results only/);
});

test('revocation is issued-only and requires a meaningful reason', () => {
  assert.equal(assertTranscriptRevokeAllowed({ status:'issued' }, 'Incorrect learner record'), 'Incorrect learner record');
  assert.throws(() => assertTranscriptRevokeAllowed({ status:'draft' }, 'Wrong data'), /Only an issued/);
  assert.throws(() => assertTranscriptRevokeAllowed({ status:'issued' }, 'bad'), /at least 5/);
});

test('snapshot hashing is canonical across object key order', () => {
  assert.equal(hashSnapshot({ b:2, a:{ y:2, x:1 } }), hashSnapshot({ a:{ x:1, y:2 }, b:2 }));
});

test('snapshot integrity detects payload tampering', () => {
  const snapshot = { student:{ name:'Alice' }, totals:{ average:80 } };
  const doc = { snapshot, snapshotHash:hashSnapshot(snapshot) };
  assert.equal(snapshotIntegrityOk(doc), true);
  doc.snapshot.totals.average = 100;
  assert.equal(snapshotIntegrityOk(doc), false);
});

test('v2 credential signature binds issue number, issue time and snapshot hash', () => {
  const snapshot = { student:{ name:'Alice' }, totals:{ average:80 } };
  const doc = {
    status:'issued', issueNumber:'CA-TR-20260829-ABCDEF123456', issuedAt:new Date('2026-08-29T10:00:00Z'),
    snapshot, snapshotHash:hashSnapshot(snapshot), verificationVersion:2,
  };
  const sig = verificationSignature(doc, SECRET);
  assert.equal(verifyTranscriptCredential(doc, sig, SECRET).ok, true);
  const tampered = { ...doc, snapshot:{ ...snapshot, totals:{ average:90 } } };
  assert.match(verifyTranscriptCredential(tampered, sig, SECRET).reason, /integrity/);
});

test('revoked credential remains cryptographically valid but verifies as revoked', () => {
  const snapshot = { student:{ name:'Alice' } };
  const doc = { status:'revoked', issueNumber:'CA-TR-X', issuedAt:new Date('2026-08-29T10:00:00Z'), snapshot, snapshotHash:hashSnapshot(snapshot), verificationVersion:2 };
  const verdict = verifyTranscriptCredential(doc, verificationSignature(doc, SECRET), SECRET);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.revoked, true);
});

test('legacy verification signatures remain accepted only for legacy-version credentials', () => {
  const snapshot = { student:{ name:'Legacy' } };
  const doc = { status:'issued', issueNumber:'CA-TR-000001', issuedAt:new Date('2026-08-29T10:00:00Z'), snapshot, snapshotHash:hashSnapshot(snapshot), verificationVersion:1 };
  const legacySig = signPayload(legacyVerificationPayload(doc), SECRET);
  assert.equal(verifyTranscriptCredential(doc, legacySig, SECRET).ok, true);
  assert.equal(verifyTranscriptCredential({ ...doc, verificationVersion:2 }, legacySig, SECRET).ok, false);
});

test('issue number is date-scoped and uses cryptographic-shaped entropy', () => {
  const fakeRandom = () => Buffer.from('abcdef123456', 'hex');
  assert.equal(newIssueNumber(new Date('2026-08-29T12:00:00Z'), fakeRandom), 'CA-TR-20260829-ABCDEF123456');
});

test('display snapshot overlays current revoke state without mutating issued rows', () => {
  const original = { transcriptMeta:{ status:'issued', issueNumber:'CA-1' }, terms:[{ rows:[{ score:80 }] }] };
  const doc = { _id:'t1', status:'revoked', issueNumber:'CA-1', issuedAt:new Date(), revokedAt:new Date(), revokeReason:'Superseded', snapshot:original };
  const display = transcriptDisplaySnapshot(doc);
  assert.equal(display.transcriptMeta.status, 'revoked');
  assert.equal(display.transcriptMeta.revokeReason, 'Superseded');
  assert.equal(original.transcriptMeta.status, 'issued');
});

test('student transcript summary uses school marks/percentages and exam pass thresholds', () => {
  const rows = [
    { _id:'r1', academicYear:'2026', term:2, score:40, totalMarks:50, percentage:80, passMark:25, grade:'A', remark:'Excellent', subject:{code:'MTH',title:'Math'}, exam:{title:'Mid Term'} },
    { _id:'r2', academicYear:'2026', term:2, score:18, totalMarks:50, percentage:36, passMark:25, grade:'F', remark:'Fail', subject:{code:'ENG',title:'English'}, exam:{title:'Mid Term'} },
  ];
  const summary = summarizePublishedResults(rows);
  assert.equal(summary.average, 58);
  assert.equal(summary.latestAverage, 58);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.rows[0].rawScore, 40);
  assert.equal(summary.rows[0].totalMarks, 50);
});

const { normalizeTranscriptStatus, migrateTranscripts } = require('../scripts/lib/migrateTranscripts');

test('legacy transcript statuses normalize without treating drafts as issued', () => {
  assert.equal(normalizeTranscriptStatus({ status:'Released' }), 'issued');
  assert.equal(normalizeTranscriptStatus({ status:'cancelled' }), 'revoked');
  assert.equal(normalizeTranscriptStatus({ status:'pending' }), 'draft');
});

class FakeCollection {
  constructor(rows = [], indexes = []) { this.rows=rows.map((r)=>({...r})); this._indexes=indexes.map((i)=>({...i})); this.dropped=[]; this.created=[]; }
  find() { return { toArray:async()=>this.rows.map((r)=>({...r})) }; }
  async updateOne(filter, update) { const row=this.rows.find((r)=>String(r._id)===String(filter._id)); if(!row)return{matchedCount:0}; Object.assign(row, update.$set||{}); return{matchedCount:1}; }
  async indexes(){ return this._indexes.map((i)=>({...i})); }
  async dropIndex(name){ this.dropped.push(name); this._indexes=this._indexes.filter((i)=>i.name!==name); }
  async createIndex(key, options){ this.created.push({key:{...key},options:{...options}}); return options.name; }
}

test('transcript migration preserves strongest duplicate issue number and quarantines unsafe legacy rows', async () => {
  const studentId='65f222222222222222222222';
  const snap={ student:{ name:'Alice' }, totals:{ average:80 } };
  const tcol=new FakeCollection([
    { _id:'t1', student:studentId, status:'issued', issueNumber:'CA-OLD-1', issuedAt:new Date('2026-01-01'), snapshot:snap },
    { _id:'t2', student:studentId, status:'issued', issueNumber:'CA-OLD-1', issuedAt:new Date('2026-02-01'), snapshot:null },
    { _id:'t3', student:'missing', status:'issued', issueNumber:'CA-OLD-2', issuedAt:new Date('2026-03-01'), snapshot:snap },
  ], [{ name:'issueNumber_1', key:{issueNumber:1}, unique:false }]);
  const scol=new FakeCollection([{ _id:studentId, fullName:'Alice' }]);
  const stats=await migrateTranscripts({ Transcript:{collection:tcol}, Student:{collection:scol} });
  assert.equal(stats.scanned,3);
  assert.ok(stats.quarantined>=2);
  assert.equal(stats.duplicateGroups,0); // t2 is already quarantined for missing immutable snapshot.
  assert.deepEqual(tcol.dropped,['issueNumber_1']);
  assert.equal(tcol.created[0].options.name,'uniq_issued_transcript_number');
  const retained=tcol.rows.find((r)=>r._id==='t1');
  assert.equal(retained.status,'issued');
  assert.equal(retained.includeDraftResults,false);
  assert.equal(retained.snapshotHash,hashSnapshot(snap));
  assert.equal(retained.verificationVersion,1);
  assert.equal(retained.migrationQuarantinedAt,null);
  assert.ok(tcol.rows.find((r)=>r._id==='t2').migrationQuarantinedAt);
  assert.ok(tcol.rows.find((r)=>r._id==='t3').migrationQuarantinedAt);
});

test('transcript migration quarantines duplicate otherwise-valid issued credentials', async () => {
  const sid='65f222222222222222222222';
  const snap={ student:{name:'A'} };
  const tcol=new FakeCollection([
    { _id:'a', student:sid, status:'issued', issueNumber:'DUP-1', issuedAt:new Date('2026-01-01'), snapshot:snap },
    { _id:'b', student:sid, status:'revoked', issueNumber:'DUP-1', issuedAt:new Date('2026-02-01'), snapshot:snap, revokedAt:new Date('2026-03-01') },
  ]);
  const stats=await migrateTranscripts({ Transcript:{collection:tcol}, Student:{collection:new FakeCollection([{_id:sid}])} });
  assert.equal(stats.duplicateGroups,1);
  assert.equal(stats.duplicatesQuarantined,1);
  assert.equal(tcol.rows.filter((r)=>!r.migrationQuarantinedAt).length,1);
});
