const mongoose = require('mongoose');

const ENROLLED_STUDENT_STATUSES = Object.freeze(['active', 'on_hold', 'suspended']);
const STRUCTURE_STATUSES = Object.freeze(['active', 'inactive', 'archived']);
const SUBJECT_STATUSES = Object.freeze(['active', 'draft', 'archived']);

const str = (value, max = 2000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const idText = (value) => str(value?._id || value, 80);
const sameId = (a, b) => Boolean(idText(a) && idText(a) === idText(b));

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function studentEnrollmentFilter(field, id) {
  return {
    [field]: idText(id),
    isDeleted: { $ne: true },
    status: { $in: ENROLLED_STUDENT_STATUSES },
  };
}

async function count(Model, filter) {
  if (!Model || typeof Model.countDocuments !== 'function') return 0;
  return Number(await Model.countDocuments(filter)) || 0;
}

function dependencySpecs(kind, id) {
  const sid = idText(id);
  const specs = [];
  const add = (model, field, filter = {}) => specs.push({ model, field, filter: { [field]: sid, ...filter } });

  if (kind === 'class') {
    add('Student', 'classId');
    add('Section', 'classId');
    add('Stream', 'classId');
    add('Subject', 'classId');
    add('Exam', 'classGroup');
    add('Attendance', 'classGroup');
    add('Assignment', 'classGroup', { isDeleted: { $ne: true } });
    add('Result', 'classGroup');
    add('TimetableEntry', 'classGroup');
    add('Transcript', 'classGroup');
    add('AcademicEvent', 'classGroup', { isDeleted: { $ne: true } });
    add('FeeStructure', 'classId', { isDeleted: { $ne: true } });
    specs.push({ model: 'PromotionLog', field: 'fromClassId', filter: { $or: [{ fromClassId: sid }, { toClassId: sid }, { fromClassGroup: sid }, { toClassGroup: sid }] } });
  } else if (kind === 'section') {
    add('Student', 'sectionId');
    add('Stream', 'sectionId');
    add('Subject', 'sectionId');
    add('Exam', 'sectionId');
    add('Attendance', 'sectionId');
    add('Assignment', 'sectionId', { isDeleted: { $ne: true } });
    add('Result', 'sectionId');
    add('TimetableEntry', 'sectionId');
    add('Transcript', 'sectionId');
    add('AcademicEvent', 'sectionId', { isDeleted: { $ne: true } });
  } else if (kind === 'stream') {
    add('Student', 'streamId');
    add('Section', 'streamId');
    add('Subject', 'streamId');
    add('Applicant', 'streamId');
    add('Exam', 'streamId');
    add('Attendance', 'streamId');
    add('Assignment', 'streamId', { isDeleted: { $ne: true } });
    add('Result', 'streamId');
    add('TimetableEntry', 'streamId');
    add('Transcript', 'streamId');
    add('AcademicEvent', 'streamId', { isDeleted: { $ne: true } });
  } else if (kind === 'subject') {
    add('Student', 'subjects');
    add('Exam', 'subject');
    add('Attendance', 'subject');
    add('Assignment', 'course', { isDeleted: { $ne: true } });
    add('Result', 'subject');
    add('TimetableEntry', 'subject');
  }
  return specs;
}

async function dependencyCounts(models, kind, id) {
  const out = {};
  for (const spec of dependencySpecs(kind, id)) {
    const Model = models?.[spec.model];
    out[spec.model] = await count(Model, spec.filter);
  }
  return out;
}

function totalDependencies(counts = {}) {
  return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

async function activeStudentCount(models, kind, id) {
  const field = kind === 'class' ? 'classId' : kind === 'section' ? 'sectionId' : kind === 'stream' ? 'streamId' : null;
  if (!field) return 0;
  return count(models?.Student, studentEnrollmentFilter(field, id));
}

async function assertStatusAllowed(models, kind, id, nextStatus) {
  const allowed = kind === 'subject' ? SUBJECT_STATUSES : STRUCTURE_STATUSES;
  if (!allowed.includes(nextStatus)) throw new Error('Invalid academic status.');
  if (kind !== 'subject' && nextStatus !== 'active') {
    const enrolled = await activeStudentCount(models, kind, id);
    if (enrolled > 0) throw new Error(`Cannot ${nextStatus === 'archived' ? 'archive' : 'inactivate'} this ${kind} while ${enrolled} enrolled student${enrolled === 1 ? '' : 's'} still reference it.`);
  }
  return nextStatus;
}

async function assertDeleteAllowed(models, kind, id) {
  const counts = await dependencyCounts(models, kind, id);
  const total = totalDependencies(counts);
  if (total > 0) {
    const details = Object.entries(counts)
      .filter(([, n]) => Number(n) > 0)
      .map(([name, n]) => `${name}: ${n}`)
      .join(', ');
    throw new Error(`Cannot delete this ${kind}; dependent records exist${details ? ` (${details})` : ''}. Archive it after active enrolments are moved instead.`);
  }
  return counts;
}

async function assertStructuralMoveAllowed(models, kind, id, current, next = {}) {
  if (!current) return;
  let changed = false;
  if (kind === 'class') {
    changed = ['schoolUnitId', 'campusId', 'levelType', 'classLevel', 'academicYear', 'term']
      .some((key) => String(current[key] ?? '') !== String(next[key] ?? ''));
  } else if (kind === 'section') {
    changed = !sameId(current.classId, next.classId) || !sameId(current.streamId, next.streamId);
  } else if (kind === 'stream') {
    changed = !sameId(current.classId, next.classId) || !sameId(current.sectionId, next.sectionId);
  } else if (kind === 'subject') {
    changed = !sameId(current.classId, next.classId) || String(current.sectionId || '') !== String(next.sectionId || '') || String(current.streamId || '') !== String(next.streamId || '') || String(current.academicYear || '') !== String(next.academicYear || '') || Number(current.term || 1) !== Number(next.term || 1);
  }
  if (!changed) return;
  const counts = await dependencyCounts(models, kind, id);
  if (totalDependencies(counts) > 0) throw new Error(`Cannot move this ${kind} to a different academic scope while dependent records exist. Create a new ${kind} for the new scope and archive the old one instead.`);
}

async function aggregateStudentCounts(Student, field) {
  if (!Student || typeof Student.aggregate !== 'function') return new Map();
  const rows = await Student.aggregate([
    { $match: { isDeleted: { $ne: true }, status: { $in: ENROLLED_STUDENT_STATUSES }, [field]: { $nin: [null, ''] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return new Map((rows || []).map((row) => [String(row._id), Number(row.count) || 0]));
}

async function syncEnrollmentCounts(models) {
  const Student = models?.Student;
  if (!Student) return { classes: 0, sections: 0, streams: 0 };
  const [classCounts, sectionCounts, streamCounts] = await Promise.all([
    aggregateStudentCounts(Student, 'classId'),
    aggregateStudentCounts(Student, 'sectionId'),
    aggregateStudentCounts(Student, 'streamId'),
  ]);

  const sync = async (Model, counts) => {
    if (!Model || typeof Model.find !== 'function' || typeof Model.bulkWrite !== 'function') return 0;
    const docs = await Model.find({}).select('_id enrolledCount').lean();
    const ops = [];
    for (const doc of docs || []) {
      const actual = counts.get(String(doc._id)) || 0;
      if (Number(doc.enrolledCount || 0) !== actual) {
        ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { enrolledCount: actual } } } });
      }
    }
    if (ops.length) await Model.bulkWrite(ops, { ordered: false });
    return ops.length;
  };

  const [classes, sections, streams] = await Promise.all([
    sync(models?.Class, classCounts),
    sync(models?.Section, sectionCounts),
    sync(models?.Stream, streamCounts),
  ]);
  return { classes, sections, streams };
}

async function assertCapacityNotBelowEnrollment(models, kind, id, capacity) {
  const normalized = Math.max(0, Number(capacity) || 0);
  if (!normalized || kind === 'subject') return normalized;
  const enrolled = await activeStudentCount(models, kind, id);
  if (normalized < enrolled) throw new Error(`Capacity cannot be lower than the current enrolled count (${enrolled}).`);
  return normalized;
}

async function propagateClassMetadata(models, classId, patch) {
  const id = idText(classId);
  const update = {
    className: str(patch.name, 180), classCode: str(patch.code, 40).toUpperCase(), classLevel: str(patch.classLevel, 20).toUpperCase(),
  };
  await Promise.all([
    models?.Section?.updateMany?.({ classId: id }, { $set: update }),
    models?.Stream?.updateMany?.({ classId: id }, { $set: update }),
    models?.Subject?.updateMany?.({ classId: id }, { $set: update }),
  ]);
}

async function propagateSectionMetadata(models, sectionId, patch) {
  const id = idText(sectionId);
  const update = { sectionName: str(patch.name, 100), sectionCode: str(patch.code, 40).toUpperCase() };
  await Promise.all([
    models?.Stream?.updateMany?.({ sectionId: id }, { $set: update }),
    models?.Subject?.updateMany?.({ sectionId: id }, { $set: update }),
  ]);
}

async function propagateStreamMetadata(models, streamId, patch) {
  const id = idText(streamId);
  const update = { streamName: str(patch.name, 100), streamCode: str(patch.code, 40).toUpperCase(), classStream: str(patch.name, 20).toUpperCase() };
  await Promise.all([
    models?.Section?.updateMany?.({ streamId: id }, { $set: update }),
    models?.Subject?.updateMany?.({ streamId: id }, { $set: update }),
  ]);
}

async function propagateSubjectMetadata(models, subjectId, patch) {
  const id = idText(subjectId);
  const update = { courseName: str(patch.title, 180) };
  await models?.Assignment?.updateMany?.({ course: id, isDeleted: { $ne: true } }, { $set: update });
}

module.exports = {
  ENROLLED_STUDENT_STATUSES,
  STRUCTURE_STATUSES,
  SUBJECT_STATUSES,
  str,
  idText,
  sameId,
  escapeRegExp,
  csvCell,
  dependencyCounts,
  totalDependencies,
  activeStudentCount,
  assertStatusAllowed,
  assertDeleteAllowed,
  assertStructuralMoveAllowed,
  syncEnrollmentCounts,
  assertCapacityNotBelowEnrollment,
  propagateClassMetadata,
  propagateSectionMetadata,
  propagateStreamMetadata,
  propagateSubjectMetadata,
};
