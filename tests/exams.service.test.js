const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertStatusTransition,
  assertEditAllowed,
  assertHardDeleteAllowed,
  assertSubjectMatchesScope,
  publishedScheduleChanged,
  targetStudentFilter,
  examScheduleMessage,
  notifyTargetStudents,
  retireExamNotifications,
} = require('../src/services/tenant/examService');
const {
  normalizeExamType,
  normalizeStatus,
  normalizeTerm,
  normalizeMarks,
  parseLegacyTimeRange,
  normalizeDate,
  duplicateKey,
} = require('../scripts/lib/migrateExams');

const examId = '65f111111111111111111111';
const classId = '65f222222222222222222222';
const sectionId = '65f333333333333333333333';
const streamId = '65f444444444444444444444';
const subjectId = '65f555555555555555555555';

function exam(overrides = {}) {
  return {
    _id: examId,
    title: 'Mathematics End Term',
    code: 'MATH-END-T1',
    classGroup: classId,
    sectionId,
    streamId,
    subject: subjectId,
    academicYear: '2026',
    term: 1,
    examType: 'endterm',
    examDate: new Date('2026-09-10T08:00:00Z'),
    startTime: '08:00',
    endTime: '10:00',
    durationMinutes: 120,
    maxMarks: 100,
    passMark: 50,
    room: 'Room 4',
    campus: 'Main',
    status: 'scheduled',
    ...overrides,
  };
}

test('new exams can only be created as Draft or Scheduled', () => {
  assert.equal(assertStatusTransition('draft', 'draft', { creating: true }), 'draft');
  assert.equal(assertStatusTransition('draft', 'scheduled', { creating: true }), 'scheduled');
  assert.throws(() => assertStatusTransition('draft', 'completed', { creating: true }), /only be saved as Draft or Scheduled/);
  assert.throws(() => assertStatusTransition('draft', 'archived', { creating: true }), /only be saved as Draft or Scheduled/);
});

test('exam lifecycle permits only explicit transitions', () => {
  assert.equal(assertStatusTransition('draft', 'scheduled'), 'scheduled');
  assert.equal(assertStatusTransition('scheduled', 'completed'), 'completed');
  assert.equal(assertStatusTransition('completed', 'archived'), 'archived');
  assert.equal(assertStatusTransition('archived', 'draft'), 'draft');
  assert.throws(() => assertStatusTransition('draft', 'completed'), /Invalid exam status transition/);
  assert.throws(() => assertStatusTransition('completed', 'scheduled'), /Invalid exam status transition/);
});

test('result-bearing exams cannot move back to draft or scheduled', () => {
  assert.throws(() => assertStatusTransition('completed', 'scheduled', { resultCount: 2 }), /cannot be moved back/);
  assert.throws(() => assertStatusTransition('archived', 'draft', { resultCount: 1 }), /cannot be moved back/);
  assert.equal(assertStatusTransition('archived', 'completed', { resultCount: 1 }), 'completed');
});

test('results lock exam scope, marks, type and schedule', () => {
  const before = exam();
  assert.throws(() => assertEditAllowed(before, { ...before, maxMarks: 80 }, { resultCount: 1 }), /Cannot change exam scope/);
  assert.throws(() => assertEditAllowed(before, { ...before, examDate: new Date('2026-09-11T08:00:00Z') }, { resultCount: 1 }), /Cannot change exam scope/);
  assert.doesNotThrow(() => assertEditAllowed(before, { ...before, title: 'Updated display title', room: 'Room 7' }, { resultCount: 1 }));
});

test('completed exams lock result-defining fields even without results', () => {
  const before = exam({ status: 'completed' });
  assert.throws(() => assertEditAllowed(before, { ...before, subject: '65f666666666666666666666' }), /Completed exam/);
});

test('permanent deletion is limited to result-free draft exams', () => {
  assert.equal(assertHardDeleteAllowed(exam({ status: 'draft' }), 0), true);
  assert.throws(() => assertHardDeleteAllowed(exam({ status: 'scheduled' }), 0), /Only result-free Draft exams/);
  assert.throws(() => assertHardDeleteAllowed(exam({ status: 'draft' }), 1), /already has results/);
});

test('subject validation enforces class, section, stream, year and term scope', async () => {
  const subject = { _id: subjectId, code: 'MAT', status: 'active', classId, sectionId, streamId, academicYear: '2026', term: 1 };
  const Subject = { findById: () => ({ select: () => ({ lean: async () => subject }) }) };
  await assert.doesNotReject(() => assertSubjectMatchesScope({ Subject }, subjectId, { classId, sectionId, streamId }, { academicYear: '2026', term: 1 }));
  await assert.rejects(() => assertSubjectMatchesScope({ Subject }, subjectId, { classId: '65f777777777777777777777', sectionId, streamId }, { academicYear: '2026', term: 1 }), /does not belong to the selected class/);
});

test('published schedule changes are detected only while exam remains visible', () => {
  const before = exam();
  assert.equal(publishedScheduleChanged(before, { ...before, room: 'Room 10' }), true);
  assert.equal(publishedScheduleChanged(before, { ...before, title: 'New title' }), false);
  assert.equal(publishedScheduleChanged(before, { ...before, status: 'archived', room: 'Room 10' }), false);
});

test('student targeting is constrained to active class/section/stream/year/term users', () => {
  const filter = targetStudentFilter(exam());
  assert.equal(filter.status, 'active');
  assert.equal(filter.classId, classId);
  assert.equal(filter.sectionId, sectionId);
  assert.equal(filter.streamId, streamId);
  assert.equal(filter.academicYear, '2026');
  assert.equal(filter.term, 1);
  assert.deepEqual(filter.isDeleted, { $ne: true });
  assert.deepEqual(filter.userId, { $ne: null });
});

test('exam schedule message contains canonical date, time and venue fields', () => {
  const message = examScheduleMessage(exam(), true);
  assert.match(message, /schedule for Mathematics End Term/);
  assert.match(message, /08:00 - 10:00/);
  assert.match(message, /Room 4, Main/);
});

test('student notifications are user-targeted and idempotently upserted', async () => {
  const captured = [];
  const Student = {
    find: (filter) => ({ select: () => ({ lean: async () => [{ userId: '65f888888888888888888888' }, { userId: '65f888888888888888888888' }, { userId: '65f999999999999999999999' }] }) }),
  };
  const Notification = { bulkWrite: async (ops, options) => { captured.push({ ops, options }); } };
  const count = await notifyTargetStudents({ Student, Notification }, exam(), 'scheduled', '65faaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(count, 2);
  assert.equal(captured[0].ops.length, 2);
  assert.equal(captured[0].ops[0].updateOne.upsert, true);
  assert.equal(captured[0].ops[0].updateOne.filter.entityType, 'Exam');
  assert.equal(captured[0].ops[0].updateOne.filter.entityAction, 'scheduled');
  assert.equal(captured[0].ops[0].updateOne.update.$set.url, '/student/exams');
});

test('withdrawn exam notifications are soft-deleted by exam identity', async () => {
  let captured;
  const Notification = { updateMany: async (filter, update) => { captured = { filter, update }; return { modifiedCount: 3 }; } };
  const count = await retireExamNotifications({ Notification }, examId, '65faaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(count, 3);
  assert.equal(captured.filter.entityType, 'Exam');
  assert.equal(captured.filter.entityId, examId);
  assert.equal(captured.update.$set.isDeleted, true);
  assert.ok(captured.update.$set.deletedAt instanceof Date);
});

test('legacy exam type/status normalization maps old vocabulary safely', () => {
  assert.equal(normalizeExamType('Final Exam'), 'endterm');
  assert.equal(normalizeExamType('Class Test'), 'test');
  assert.equal(normalizeExamType('unknown'), 'test');
  assert.equal(normalizeStatus('Published'), 'scheduled');
  assert.equal(normalizeStatus('Done'), 'completed');
  assert.equal(normalizeStatus('Cancelled'), 'archived');
  assert.equal(normalizeStatus('mystery'), 'draft');
});

test('legacy term/marks/time normalization is bounded', () => {
  assert.equal(normalizeTerm(8), 3);
  assert.equal(normalizeTerm(0), 1);
  assert.deepEqual(normalizeMarks(40, 80), { maxMarks: 40, passMark: 40 });
  assert.deepEqual(parseLegacyTimeRange({ time: '8:30 - 10:15' }), { startTime: '08:30', endTime: '10:15' });
});

test('legacy exam dates are canonicalized to a UTC calendar date', () => {
  assert.equal(normalizeDate('2026-09-10').toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(normalizeDate('2026-09-10T23:30:00+03:00').toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(normalizeDate('not-a-date'), null);
});

test('duplicate keys apply only to active exam records', () => {
  const active = duplicateKey(exam());
  assert.ok(active.includes(classId));
  assert.equal(duplicateKey(exam({ status: 'archived' })), '');
});

test('exam migration converts legacy rows, keeps the result-bearing duplicate, and rebuilds the partial unique index', async () => {
  const { migrateExams, EXAM_INDEX_KEY, EXAM_INDEX_NAME } = require('../scripts/lib/migrateExams');
  const rows = [
    { _id: 'e1', classId, courseCode: 'MAT', courseTitle: 'Math', date: '2026-09-10T08:00:00Z', type: 'Final Exam', status: 'Published', academicYear: '2026', term: 1 },
    { _id: 'e2', classId, courseCode: 'MAT', courseTitle: 'Math', date: '2026-09-10T08:00:00Z', type: 'Final Exam', status: 'Published', academicYear: '2026', term: 1 },
    { _id: 'e3', classId: 'missing', courseCode: 'BAD', date: 'not-a-date', status: 'Published' },
  ];
  const dropped = [];
  const createdIndexes = [];
  const Exam = { collection: {
    find: () => ({ toArray: async () => rows }),
    updateOne: async (filter, update) => { const row = rows.find((x) => x._id === filter._id); Object.assign(row, update.$set); },
    indexes: async () => [{ name: '_id_', key: { _id: 1 } }, { name: 'old_exam_unique', key: EXAM_INDEX_KEY, unique: true }],
    dropIndex: async (name) => dropped.push(name),
    createIndex: async (key, options) => createdIndexes.push({ key, options }),
  } };
  const Class = { collection: { find: () => ({ toArray: async () => [{ _id: classId, code: 'S1', name: 'Senior One', academicYear: '2026', term: 1 }] }) } };
  const Subject = { collection: { find: () => ({ toArray: async () => [{ _id: subjectId, code: 'MAT', title: 'Mathematics', classId }] }) } };
  const emptyCollection = { collection: { find: () => ({ toArray: async () => [] }) } };
  const Result = { countDocuments: async ({ exam }) => exam === 'e2' ? 2 : 0 };

  const result = await migrateExams({ Exam, Class, Section: emptyCollection, Stream: emptyCollection, Subject, Result });
  assert.equal(result.scanned, 3);
  assert.equal(result.archivedUnresolved, 1);
  assert.equal(result.duplicateGroups, 1);
  assert.equal(result.duplicatesArchived, 1);
  assert.equal(rows.find((x) => x._id === 'e2').status, 'scheduled');
  assert.equal(rows.find((x) => x._id === 'e1').status, 'archived');
  assert.equal(rows.find((x) => x._id === 'e3').status, 'archived');
  assert.deepEqual(dropped, ['old_exam_unique']);
  assert.equal(createdIndexes[0].options.name, EXAM_INDEX_NAME);
  assert.deepEqual(createdIndexes[0].options.partialFilterExpression, { archivedAt: null });
});
