const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeScore,
  assertExamAllowsResultEntry,
  assertExamAllowsPublication,
  assertStudentMatchesExamScope,
  targetStudentFilter,
  assertResultEditable,
  assertIdentityChangeAllowed,
  assertDeleteAllowed,
  resultStatusUpdate,
  buildResultValues,
  studentPublishedResultFilter,
  csvCell,
  escapeRegExp,
} = require('../src/services/tenant/resultService');

const examId = '65f111111111111111111111';
const studentId = '65f222222222222222222222';
const classId = '65f333333333333333333333';
const sectionId = '65f444444444444444444444';
const streamId = '65f555555555555555555555';
const subjectId = '65f666666666666666666666';
const actorId = '65f777777777777777777777';

function exam(overrides = {}) {
  return {
    _id: examId, status: 'completed', classGroup: classId, sectionId, sectionName: 'A', sectionCode: 'A',
    streamId, streamName: 'Blue', streamCode: 'BLU', subject: subjectId, academicYear: '2026', term: 1,
    maxMarks: 80, passMark: 40, ...overrides,
  };
}
function student(overrides = {}) {
  return {
    _id: studentId, status: 'active', isDeleted: false, classId, sectionId, streamId, academicYear: '2026', term: 1,
    ...overrides,
  };
}

test('score validation rejects impossible marks instead of clamping them', () => {
  assert.deepEqual(normalizeScore(64, 80), { totalMarks: 80, score: 64, percentage: 80 });
  assert.throws(() => normalizeScore(81, 80), /cannot exceed/);
  assert.throws(() => normalizeScore(-1, 80), /zero or greater/);
  assert.throws(() => normalizeScore(1, 0), /greater than zero/);
});

test('draft entry is limited to scheduled/completed exams and publication requires completed', () => {
  assert.equal(assertExamAllowsResultEntry(exam({ status: 'scheduled' })), true);
  assert.equal(assertExamAllowsResultEntry(exam({ status: 'completed' })), true);
  assert.throws(() => assertExamAllowsResultEntry(exam({ status: 'draft' })), /Scheduled or Completed/);
  assert.throws(() => assertExamAllowsPublication(exam({ status: 'scheduled' })), /after the exam is Completed/);
  assert.equal(assertExamAllowsPublication(exam()), true);
});

test('student result entry is restricted to active exact exam scope/year/term', () => {
  assert.equal(assertStudentMatchesExamScope(student(), exam()), true);
  assert.throws(() => assertStudentMatchesExamScope(student({ status: 'suspended' }), exam()), /Only active students/);
  assert.throws(() => assertStudentMatchesExamScope(student({ classId: '65f888888888888888888888' }), exam()), /exam class/);
  assert.throws(() => assertStudentMatchesExamScope(student({ academicYear: '2025' }), exam()), /academic year/);
  assert.throws(() => assertStudentMatchesExamScope(student({ term: 2 }), exam()), /term/);
});

test('result option student filter includes active academic scope', () => {
  assert.deepEqual(targetStudentFilter(exam()), {
    isDeleted: { $ne: true }, status: 'active', classId, sectionId, streamId, academicYear: '2026', term: 1,
  });
});

test('published results are immutable until explicitly reopened', () => {
  assert.throws(() => assertResultEditable({ status: 'published' }), /locked/);
  assert.equal(assertResultEditable({ status: 'draft' }), true);
});

test('ever-published results cannot be reassigned or permanently deleted', () => {
  const result = { status: 'draft', exam: examId, student: studentId, firstPublishedAt: new Date() };
  assert.equal(assertIdentityChangeAllowed(result, examId, studentId), true);
  assert.throws(() => assertIdentityChangeAllowed(result, '65f999999999999999999999', studentId), /cannot be reassigned/);
  assert.throws(() => assertDeleteAllowed(result), /retained for audit/);
  assert.equal(assertDeleteAllowed({ status: 'draft' }), true);
  assert.throws(() => assertDeleteAllowed({ status: 'published' }), /cannot be deleted/);
});

test('explicit reopen and republish records lifecycle/audit state', () => {
  const first = new Date('2026-08-29T10:00:00Z');
  const reopen = resultStatusUpdate({ status: 'published', firstPublishedAt: first }, 'draft', actorId, exam(), new Date('2026-08-29T11:00:00Z'));
  assert.equal(reopen.status, 'draft');
  assert.equal(reopen.publishedAt, null);
  assert.equal(String(reopen.reopenedBy), actorId);
  const republish = resultStatusUpdate({ status: 'draft', firstPublishedAt: first, revision: 0 }, 'published', actorId, exam(), new Date('2026-08-29T12:00:00Z'));
  assert.equal(republish.status, 'published');
  assert.equal(republish.firstPublishedAt, first);
  assert.equal(republish.revision, 1);
});

test('result value builder copies canonical exam scope and computes percentage/grade', () => {
  const values = buildResultValues({ exam: exam(), student: student(), score: 64, actorId });
  assert.equal(String(values.exam), examId);
  assert.equal(String(values.student), studentId);
  assert.equal(String(values.classGroup), classId);
  assert.equal(String(values.subject), subjectId);
  assert.equal(values.totalMarks, 80);
  assert.equal(values.percentage, 80);
  assert.equal(values.grade, 'A');
  assert.equal(values.status, 'draft');
});

test('creating a published result requires a completed exam', () => {
  assert.throws(() => buildResultValues({ exam: exam({ status: 'scheduled' }), student: student(), score: 40, status: 'published' }), /after the exam is Completed/);
  const values = buildResultValues({ exam: exam(), student: student(), score: 40, status: 'published', actorId });
  assert.ok(values.publishedAt instanceof Date);
  assert.ok(values.firstPublishedAt instanceof Date);
  assert.equal(String(values.publishedBy), actorId);
});

test('student/parent visibility filter is canonical and published-only', () => {
  assert.deepEqual(studentPublishedResultFilter(studentId, { academicYear: '2026' }), {
    student: studentId, status: 'published', migrationQuarantinedAt: null, academicYear: '2026',
  });
});

test('CSV cells neutralize spreadsheet formulas and search regex is escaped', () => {
  assert.equal(csvCell('=2+2'), '"\'=2+2"');
  assert.equal(csvCell(' +SUM(A1:A2)'), '"\' +SUM(A1:A2)"');
  assert.equal(escapeRegExp('a.*(b)'), 'a\\.\\*\\(b\\)');
});

const {
  normalizeStatus: normalizeLegacyResultStatus,
  extractLegacyScore,
  migrateResults,
} = require('../scripts/lib/migrateResults');

test('legacy result status and marks normalize conservatively', () => {
  assert.equal(normalizeLegacyResultStatus({ status: 'Released' }), 'published');
  assert.equal(normalizeLegacyResultStatus({ status: 'pending' }), 'draft');
  assert.deepEqual(extractLegacyScore({ percentage: 75 }, { maxMarks: 80 }), {
    ok: true, totalMarks: 80, score: 60, percentage: 75,
  });
  assert.equal(extractLegacyScore({ score: 81 }, { maxMarks: 80 }).ok, false);
  assert.equal(extractLegacyScore({}, { maxMarks: 80 }).ok, false);
});

class FakeCollection {
  constructor(rows = [], indexes = []) {
    this.rows = rows.map((r) => ({ ...r }));
    this._indexes = indexes.map((i) => ({ ...i }));
    this.dropped = [];
    this.created = [];
  }
  find() { return { toArray: async () => this.rows.map((r) => ({ ...r })) }; }
  async updateOne(filter, update) {
    const row = this.rows.find((r) => String(r._id) === String(filter._id));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set || {});
    return { matchedCount: 1 };
  }
  async indexes() { return this._indexes.map((i) => ({ ...i })); }
  async dropIndex(name) {
    this.dropped.push(name);
    this._indexes = this._indexes.filter((i) => i.name !== name);
  }
  async createIndex(key, options) {
    this.created.push({ key: { ...key }, options: { ...options } });
    return options.name;
  }
}

test('result migration keeps the best duplicate, quarantines unsafe rows, and rebuilds partial uniqueness', async () => {
  const oldIndex = { name: 'exam_1_student_1', key: { exam: 1, student: 1 }, unique: true };
  const resultCollection = new FakeCollection([
    { _id: 'r1', examId: 'EX-1', studentId: 'REG001', marks: 64, status: 'released', updatedAt: new Date('2026-08-29T10:00:00Z') },
    { _id: 'r2', examId: 'EX-1', studentId: 'REG001', percentage: 50, status: 'draft', updatedAt: new Date('2026-08-29T11:00:00Z') },
    { _id: 'r3', examId: 'UNKNOWN', studentId: 'MISSING', score: 20, status: 'published', updatedAt: new Date('2026-08-29T12:00:00Z') },
  ], [oldIndex]);
  const examCollection = new FakeCollection([{
    _id: examId, code: 'EX-1', title: 'Term 1 Mathematics', classGroup: classId, sectionId, sectionName: 'A', sectionCode: 'A',
    streamId, streamName: 'Blue', streamCode: 'BLU', subject: subjectId, academicYear: '2026', term: 1, maxMarks: 80, passMark: 40,
  }]);
  const studentCollection = new FakeCollection([{ _id: studentId, regNo: 'REG001', fullName: 'Student One' }]);
  const models = {
    Result: { collection: resultCollection },
    Exam: { collection: examCollection },
    Student: { collection: studentCollection },
  };

  const stats = await migrateResults(models);
  assert.equal(stats.scanned, 3);
  assert.equal(stats.normalized, 3);
  assert.equal(stats.quarantined, 1);
  assert.equal(stats.duplicateGroups, 1);
  assert.equal(stats.duplicatesQuarantined, 1);
  assert.deepEqual(resultCollection.dropped, ['exam_1_student_1']);
  assert.equal(resultCollection.created.length, 1);
  assert.deepEqual(resultCollection.created[0].options.partialFilterExpression, { migrationQuarantinedAt: null });

  const retained = resultCollection.rows.find((r) => r._id === 'r1');
  const duplicate = resultCollection.rows.find((r) => r._id === 'r2');
  const unresolved = resultCollection.rows.find((r) => r._id === 'r3');
  assert.equal(String(retained.exam), examId);
  assert.equal(String(retained.student), studentId);
  assert.equal(retained.score, 64);
  assert.equal(retained.percentage, 80);
  assert.equal(retained.status, 'published');
  assert.equal(retained.passMark, 40);
  assert.equal(retained.migrationQuarantinedAt, null);
  assert.ok(duplicate.migrationQuarantinedAt);
  assert.match(duplicate.migrationQuarantineReason, /Duplicate exam\/student result/);
  assert.ok(unresolved.migrationQuarantinedAt);
  assert.match(unresolved.migrationQuarantineReason, /could not be resolved/);
});
