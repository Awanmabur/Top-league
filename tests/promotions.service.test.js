const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CLASS_LEVELS,
  TARGET_STATUSES,
  normalizeAcademicYear,
  academicYearStart,
  normalizePromotionStatus,
  promotionBatchId,
  progressionAction,
  claimBatch,
  releaseBatch,
  csvCell,
} = require('../src/services/tenant/promotionService');
const { inferAction, migratePromotions } = require('../scripts/lib/migratePromotions');

const id1 = '65f111111111111111111111';
const id2 = '65f222222222222222222222';
const cls1 = '65f333333333333333333333';
const cls2 = '65f444444444444444444444';

function student(overrides = {}) {
  return { _id: id1, regNo: 'STD-1', status: 'active', classId: cls1, classLevel: 'S1', academicYear: '2025/2026', term: 3, ...overrides };
}
function dest(overrides = {}) {
  return { _id: cls2, status: 'active', classLevel: 'S2', academicYear: '2026/2027', term: 1, ...overrides };
}

test('promotion academic year and status normalization fails closed', () => {
  assert.equal(normalizeAcademicYear('2026/2027'), '2026/2027');
  assert.equal(normalizeAcademicYear('2026-27'), '2026-27');
  assert.equal(normalizeAcademicYear('26/27'), '');
  assert.equal(academicYearStart('2026/2027'), 2026);
  assert.deepEqual(TARGET_STATUSES, ['active', 'graduated']);
  assert.equal(normalizePromotionStatus(' Suspended '), '');
});

test('promotion batch IDs are dated and cryptographically suffixed', () => {
  assert.match(promotionBatchId(new Date('2026-08-29T12:00:00Z')), /^PROMO-20260829-[0-9A-F]{12}$/);
});

test('class progression order is explicit and includes S6 terminal level', () => {
  assert.equal(CLASS_LEVELS[0], 'BABY');
  assert.equal(CLASS_LEVELS.at(-1), 'S6');
  assert.ok(CLASS_LEVELS.indexOf('S2') > CLASS_LEVELS.indexOf('S1'));
});

test('only Active students can be processed by Promotions', () => {
  assert.throws(() => progressionAction(student({ status: 'suspended' }), dest(), { toAcademicYear: '2026/2027', toTerm: 1, toStatus: 'active' }), /not Active/);
});

test('normal promotion cannot move backwards or skip a class level', () => {
  assert.throws(() => progressionAction(student({ classLevel: 'S3' }), dest({ classLevel: 'S2' }), { toAcademicYear: '2026/2027', toTerm: 1, toStatus: 'active' }), /backwards/);
  assert.throws(() => progressionAction(student({ classLevel: 'S1' }), dest({ classLevel: 'S3' }), { toAcademicYear: '2026/2027', toTerm: 1, toStatus: 'active' }), /skip more than one/);
});

test('next-class promotion requires a later academic year', () => {
  assert.throws(() => progressionAction(student(), dest({ academicYear: '2025/2026' }), { toAcademicYear: '2025/2026', toTerm: 1, toStatus: 'active' }), /requires a later academic year/);
  assert.equal(progressionAction(student(), dest(), { toAcademicYear: '2026/2027', toTerm: 1, toStatus: 'active' }), 'promoted');
});

test('same-class progression distinguishes later term and repeated year', () => {
  const sameClass = dest({ _id: cls1, classLevel: 'S1', academicYear: '2025/2026', term: 2 });
  assert.equal(progressionAction(student({ term: 1 }), sameClass, { toAcademicYear: '2025/2026', toTerm: 2, toStatus: 'active' }), 'advanced_term');
  assert.equal(progressionAction(student(), sameClass, { toAcademicYear: '2026/2027', toTerm: 1, toStatus: 'active' }), 'repeated');
});

test('same placement/year/term is a no-op', () => {
  const sameClass = dest({ _id: cls1, classLevel: 'S1', academicYear: '2025/2026', term: 3 });
  assert.equal(progressionAction(student(), sameClass, { toAcademicYear: '2025/2026', toTerm: 3, toStatus: 'active' }), 'noop');
});

test('graduation is restricted to S6', () => {
  assert.throws(() => progressionAction(student({ classLevel: 'S5' }), null, { toAcademicYear: '2026/2027', toTerm: 3, toStatus: 'graduated' }), /Only S6/);
  assert.equal(progressionAction(student({ classLevel: 'S6' }), null, { toAcademicYear: '2026/2027', toTerm: 3, toStatus: 'graduated' }), 'graduated');
});

test('promotion CSV cells neutralize spreadsheet formulas', () => {
  assert.match(csvCell('=HYPERLINK("bad")'), /^"'/);
  assert.equal(csvCell('Promoted'), '"Promoted"');
});

test('claimBatch atomically claims only active available students and releases partial claims on failure', async () => {
  const released = [];
  let calls = 0;
  const Student = {
    async findOneAndUpdate(filter, update) {
      calls += 1;
      assert.equal(filter.status, 'active');
      assert.ok(filter.$or.some((x) => x.promotionLeaseExpiresAt?.$lte));
      if (calls === 1) return { _id: id1, ...update.$set };
      return null;
    },
    updateMany: async (filter, update) => { released.push({ filter, update }); return { modifiedCount: 1 }; },
  };
  await assert.rejects(() => claimBatch(Student, [id1, id2], null, new Date('2026-08-29T10:00:00Z')), /unavailable/);
  assert.equal(released.length, 1);
  assert.deepEqual(released[0].filter._id.$in, [id1]);
  assert.equal(released[0].update.$set.promotionLeaseToken, '');
});

test('releaseBatch is token guarded', async () => {
  let filter;
  const Student = { updateMany: async (f) => { filter = f; return { modifiedCount: 2 }; } };
  await releaseBatch(Student, [id1, id2], 'PROMO-TOKEN');
  assert.equal(filter.promotionLeaseToken, 'PROMO-TOKEN');
  assert.deepEqual(filter._id.$in, [id1, id2]);
});

test('legacy promotion action inference is deterministic', () => {
  assert.equal(inferAction({ toStatus: 'graduated' }), 'graduated');
  assert.equal(inferAction({ fromYearLevel: 'S1', toYearLevel: 'S1', fromAcademicYear: '2025/2026', toAcademicYear: '2026/2027' }), 'repeated');
  assert.equal(inferAction({ fromYearLevel: 'S1', toYearLevel: 'S1', fromTerm: 1, toTerm: 2 }), 'advanced_term');
  assert.equal(inferAction({ fromYearLevel: 'S1', toYearLevel: 'S2' }), 'promoted');
});

test('promotion migration normalizes legacy logs and clears only expired leases', async () => {
  const rows = [{ _id: id1, fromSemester: 1, toSemester: 2, fromYearLevel: 's1', toYearLevel: 's1', fromClassGroup: cls1, toClassGroup: cls1 }];
  const updates = [];
  const cursor = { i: 0, async hasNext(){ return this.i < rows.length; }, async next(){ return rows[this.i++]; } };
  let leaseFilter;
  const models = {
    PromotionLog: { collection: { find: () => cursor, updateOne: async (...args) => updates.push(args) } },
    Student: { updateMany: async (filter) => { leaseFilter = filter; return { modifiedCount: 3 }; } },
  };
  const result = await migratePromotions(models, new Date('2026-08-29T10:00:00Z'));
  assert.equal(result.logsScanned, 1);
  assert.equal(result.logsNormalized, 1);
  assert.equal(result.expiredLeasesCleared, 3);
  assert.match(updates[0][1].$set.batchId, /^LEGACY-/);
  assert.equal(updates[0][1].$set.fromTerm, 1);
  assert.equal(updates[0][1].$set.toTerm, 2);
  assert.equal(updates[0][1].$set.action, 'advanced_term');
  assert.deepEqual(leaseFilter.promotionLeaseExpiresAt, { $lte: new Date('2026-08-29T10:00:00Z') });
});
