const test = require('node:test');
const assert = require('node:assert/strict');

const {
  allocateApplicationId,
  allocateOfferLetterNo,
  claimApplicantConversion,
  finalizeApplicantConversion,
  releaseApplicantConversion,
  CONVERSION_LEASE_MS,
  applicationIdCandidate,
  offerLetterNoCandidate,
  canTransitionApplicantStatus,
  assertApplicantTransition,
  documentCompleteness,
  normalizeRequestedDocKeys,
  normalizeChecklist,
  normalizeInterviewMode,
  normalizeRequestChannel,
  sanitizeTags,
  csvCell,
  requestDocsEmail,
  interviewEmail,
} = require('../src/services/tenant/admissionsService');

test('application IDs use the canonical APP-year-random format', () => {
  const id = applicationIdCandidate(new Date('2026-08-29T00:00:00Z'));
  assert.match(id, /^APP-2026-\d{8}$/);
});

test('offer letter numbers use a dated cryptographic suffix format', () => {
  const no = offerLetterNoCandidate(new Date('2026-08-29T00:00:00Z'));
  assert.match(no, /^OFF-20260829-[0-9A-F]{10}$/);
});

test('application allocator retries database collisions', async () => {
  let calls = 0;
  const Applicant = { exists: async () => (++calls < 3 ? { _id: 'x' } : null) };
  const id = await allocateApplicationId(Applicant, new Date('2026-08-29T00:00:00Z'), 5);
  assert.match(id, /^APP-2026-\d{8}$/);
  assert.equal(calls, 3);
});

test('offer letter allocator retries database collisions', async () => {
  let calls = 0;
  const OfferLetter = { exists: async () => (++calls < 2 ? { _id: 'x' } : null) };
  const no = await allocateOfferLetterNo(OfferLetter, new Date('2026-08-29T00:00:00Z'), 5);
  assert.match(no, /^OFF-20260829-[0-9A-F]{10}$/);
  assert.equal(calls, 2);
});

test('applicant lifecycle blocks converted changes and rejected direct conversion', () => {
  assert.equal(canTransitionApplicantStatus('converted', 'under_review'), false);
  assert.equal(canTransitionApplicantStatus('rejected', 'converted', { allowConversion: true }), false);
  assert.equal(canTransitionApplicantStatus('submitted', 'converted', { allowConversion: true }), false);
  assert.equal(canTransitionApplicantStatus('accepted', 'converted', { allowConversion: true }), true);
  assert.equal(canTransitionApplicantStatus('under_review', 'accepted'), true);
  assert.throws(() => assertApplicantTransition('accepted', 'converted'), /cannot move/);
});



test('conversion claim uses an atomic accepted-status lease and permits stale-lease recovery only', async () => {
  const calls = [];
  const Applicant = {
    async findOneAndUpdate(filter, update, options) {
      calls.push({ filter, update, options });
      return { _id: 'a1', status: 'accepted', conversionLockToken: update.$set.conversionLockToken };
    },
  };
  const now = new Date('2030-01-01T12:00:00Z');
  const { token, applicant } = await claimApplicantConversion(Applicant, {
    id: 'a1', currentStatus: 'under_review', actorUserId: 'u1', now, decisionNote: 'Approved',
  });
  assert.equal(applicant.status, 'accepted');
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.filter._id, 'a1');
  assert.equal(call.filter.status, 'under_review');
  assert.equal(call.filter.convertedStudentId, null);
  assert.equal(call.options.new, true);
  assert.equal(call.update.$set.status, 'accepted');
  assert.equal(call.update.$set.conversionLockToken, token);
  assert.equal(call.update.$set.conversionLockAt.toISOString(), now.toISOString());
  const staleClause = call.filter.$or.find((item) => item.conversionLockAt && item.conversionLockAt.$lt);
  assert.ok(staleClause);
  assert.equal(staleClause.conversionLockAt.$lt.getTime(), now.getTime() - CONVERSION_LEASE_MS);
});

test('conversion claim fails closed when another request already owns the lease', async () => {
  const Applicant = { async findOneAndUpdate() { return null; } };
  await assert.rejects(
    claimApplicantConversion(Applicant, { id: 'a1', currentStatus: 'accepted' }),
    /already being admitted or changed/,
  );
});

test('conversion finalization requires the matching lease token and release only clears unconverted accepted claims', async () => {
  const updates = [];
  const Applicant = {
    async updateOne(filter, update) {
      updates.push({ filter, update });
      return { modifiedCount: 1 };
    },
  };
  await finalizeApplicantConversion(Applicant, {
    id: 'a1', token: 'lease-token', studentId: 's1', regNo: 'REG-1', sectionId: 'sec1',
  });
  assert.deepEqual(updates[0].filter, {
    _id: 'a1', isDeleted: { $ne: true }, status: 'accepted', conversionLockToken: 'lease-token', convertedStudentId: null,
  });
  assert.equal(updates[0].update.$set.status, 'converted');
  assert.equal(updates[0].update.$set.convertedStudentId, 's1');
  assert.equal(updates[0].update.$set.conversionLockToken, '');

  await releaseApplicantConversion(Applicant, 'a1', 'lease-token');
  assert.deepEqual(updates[1].filter, {
    _id: 'a1', conversionLockToken: 'lease-token', status: 'accepted', convertedStudentId: null,
  });
  assert.equal(updates[1].update.$set.conversionLockToken, '');
});

test('conversion finalization fails closed when the lease no longer matches', async () => {
  const Applicant = { async updateOne() { return { modifiedCount: 0 }; } };
  await assert.rejects(
    finalizeApplicantConversion(Applicant, { id: 'a1', token: 'lost', studentId: 's1' }),
    /could not be finalized safely/,
  );
});

test('document completeness is based on the three real required uploads only', () => {
  const stats = documentCompleteness({
    idDocument: { url: 'id.pdf', verified: true },
    passportPhoto: { url: 'photo.jpg', verified: false },
    transcript: null,
    certificates: { url: 'legacy.pdf', verified: true },
  });
  assert.deepEqual(stats, { total: 3, uploaded: 2, verified: 1, missingKeys: ['transcript'] });
});

test('requested document keys are restricted and de-duplicated', () => {
  assert.deepEqual(
    normalizeRequestedDocKeys('idDocument,evil,idDocument,transcript'),
    ['idDocument', 'transcript'],
  );
});

test('checklist normalization converts only explicit checked values', () => {
  assert.deepEqual(normalizeChecklist({ identityVerified: 'on', feeCleared: 'false' }), {
    identityVerified: true,
    academicsReviewed: false,
    documentsComplete: false,
    feeCleared: false,
  });
});

test('interview/request channel normalizers fail to safe defaults', () => {
  assert.equal(normalizeInterviewMode('ONLINE'), 'online');
  assert.equal(normalizeInterviewMode('telepathy'), 'in-person');
  assert.equal(normalizeRequestChannel('both'), 'both');
  assert.equal(normalizeRequestChannel('push'), 'email');
});

test('tag normalization bounds, lowercases and de-duplicates tags', () => {
  assert.deepEqual(sanitizeTags(' High_Priority,needs_docs,HIGH_PRIORITY '), ['high_priority', 'needs_docs']);
});

test('CSV cells neutralize spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("https://evil")'), '"\'=HYPERLINK(""https://evil"")"');
  assert.equal(csvCell('normal'), '"normal"');
});

test('admissions emails escape applicant/custom text while keeping system structure', () => {
  const docs = requestDocsEmail({
    applicant: { fullName: '<img src=x onerror=1>', applicationId: 'APP-1' },
    keys: ['idDocument'],
    message: '<script>alert(1)</script>',
    tenantName: '<School>',
  });
  assert.doesNotMatch(docs.html, /<script>/);
  assert.match(docs.html, /&lt;script&gt;/);
  assert.match(docs.html, /&lt;School&gt;/);

  const interview = interviewEmail({
    applicant: { fullName: '<b>A</b>', applicationId: 'APP-1' },
    when: new Date('2030-01-01T10:00:00Z'),
    mode: '<online>',
    panel: '<Admin>',
  });
  assert.doesNotMatch(interview.html, /<online>/);
  assert.match(interview.html, /&lt;online&gt;/);
});
