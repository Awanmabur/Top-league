const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeRegExp, csvCell, dependencyCounts, assertDeleteAllowed, assertStatusAllowed,
  assertStructuralMoveAllowed, assertCapacityNotBelowEnrollment, syncEnrollmentCounts,
} = require('../src/services/tenant/academicCatalogService');

test('academic catalog search escapes regex metacharacters', () => {
  assert.equal(escapeRegExp('S1+[A].*'), 'S1\\+\\[A\\]\\.\\*');
});

test('academic catalog CSV neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('@cmd'), '"\'@cmd"');
});

test('class dependency counts include students and downstream academic records', async () => {
  const mk = (n) => ({ countDocuments: async () => n });
  const counts = await dependencyCounts({ Student: mk(2), Section: mk(1), Subject: mk(3) }, 'class', '507f1f77bcf86cd799439011');
  assert.equal(counts.Student, 2); assert.equal(counts.Section, 1); assert.equal(counts.Subject, 3);
});

test('hard delete fails when dependent academic records exist', async () => {
  const Student = { countDocuments: async () => 1 };
  await assert.rejects(() => assertDeleteAllowed({ Student }, 'class', '507f1f77bcf86cd799439011'), /Cannot delete this class/);
});

test('inactivation/archive of class with enrolled students fails closed', async () => {
  const Student = { countDocuments: async () => 2 };
  await assert.rejects(() => assertStatusAllowed({ Student }, 'class', '507f1f77bcf86cd799439011', 'inactive'), /2 enrolled students/);
  await assert.rejects(() => assertStatusAllowed({ Student }, 'class', '507f1f77bcf86cd799439011', 'archived'), /2 enrolled students/);
});

test('subject archive is allowed but invalid subject status is rejected', async () => {
  assert.equal(await assertStatusAllowed({}, 'subject', 'x', 'archived'), 'archived');
  await assert.rejects(() => assertStatusAllowed({}, 'subject', 'x', 'inactive'), /Invalid academic status/);
});

test('structural class move is blocked after dependencies exist', async () => {
  const Section = { countDocuments: async () => 1 };
  await assert.rejects(() => assertStructuralMoveAllowed({ Section }, 'class', '507f1f77bcf86cd799439011', {
    schoolUnitId:'u1', campusId:'c1', levelType:'secondary', classLevel:'S1', academicYear:'2026', term:1,
  }, {
    schoolUnitId:'u1', campusId:'c1', levelType:'secondary', classLevel:'S2', academicYear:'2026', term:1,
  }), /Cannot move this class/);
});

test('same academic placement can be edited without dependency rejection', async () => {
  await assert.doesNotReject(() => assertStructuralMoveAllowed({}, 'class', 'x', {
    schoolUnitId:'u1', campusId:'c1', levelType:'secondary', classLevel:'S1', academicYear:'2026', term:1,
  }, {
    schoolUnitId:'u1', campusId:'c1', levelType:'secondary', classLevel:'S1', academicYear:'2026', term:1,
  }));
});

test('capacity cannot be reduced below actual enrolled student count', async () => {
  const Student = { countDocuments: async () => 12 };
  await assert.rejects(() => assertCapacityNotBelowEnrollment({ Student }, 'class', '507f1f77bcf86cd799439011', 10), /current enrolled count \(12\)/);
  assert.equal(await assertCapacityNotBelowEnrollment({ Student }, 'class', '507f1f77bcf86cd799439011', 20), 20);
});

test('enrollment synchronization writes derived class/section/stream counts', async () => {
  const aggregate = async (pipeline) => {
    const field = String(pipeline[1].$group._id);
    if (field === '$classId') return [{ _id:'c1', count:3 }];
    if (field === '$sectionId') return [{ _id:'s1', count:2 }];
    return [{ _id:'t1', count:1 }];
  };
  const writes = {};
  const model = (key, id) => ({
    find: () => ({ select: () => ({ lean: async () => [{ _id:id, enrolledCount:0 }] }) }),
    bulkWrite: async (ops) => { writes[key] = ops; },
  });
  const result = await syncEnrollmentCounts({ Student:{ aggregate }, Class:model('class','c1'), Section:model('section','s1'), Stream:model('stream','t1') });
  assert.deepEqual(result, { classes:1, sections:1, streams:1 });
  assert.equal(writes.class[0].updateOne.update.$set.enrolledCount, 3);
  assert.equal(writes.section[0].updateOne.update.$set.enrolledCount, 2);
  assert.equal(writes.stream[0].updateOne.update.$set.enrolledCount, 1);
});
