const crypto = require('crypto');
const mongoose = require('mongoose');
const { applyStudentLifecycle, csvCell } = require('./studentLifecycleService');

const CLASS_LEVELS = Object.freeze([
  'BABY','MIDDLE','TOP','P1','P2','P3','P4','P5','P6','P7','P8','S1','S2','S3','S4','S5','S6',
]);
const TARGET_STATUSES = Object.freeze(['active','graduated']);
const str = (v, max = 2000) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

function normalizeAcademicYear(value) {
  const v = str(value, 20);
  return /^(?:19|20|21)\d{2}(?:[\/-](?:\d{2}|(?:19|20|21)\d{2}))?$/.test(v) ? v : '';
}

function academicYearStart(value) {
  const v = normalizeAcademicYear(value);
  return v ? Number(v.slice(0, 4)) : null;
}

function normalizePromotionStatus(value) {
  const v = str(value, 30).toLowerCase();
  return TARGET_STATUSES.includes(v) ? v : '';
}

function promotionBatchId(now = new Date()) {
  const day = now.toISOString().slice(0,10).replace(/-/g,'');
  return `PROMO-${day}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function progressionAction(student, destination, input = {}) {
  const toStatus = normalizePromotionStatus(input.toStatus);
  const toAcademicYear = normalizeAcademicYear(input.toAcademicYear);
  const toTerm = Number(input.toTerm);
  if (!toStatus) throw new Error('Destination status must be Active or Graduated.');
  if (!toAcademicYear || ![1,2,3].includes(toTerm)) throw new Error('A valid destination academic year and term are required.');
  if (student.status !== 'active') throw new Error(`${student.regNo || 'Student'} is not Active and cannot be promoted.`);

  const fromYear = academicYearStart(student.academicYear);
  const toYear = academicYearStart(toAcademicYear);
  if (fromYear && toYear < fromYear) throw new Error('Promotion cannot move a student to an earlier academic year.');

  if (toStatus === 'graduated') {
    if (String(student.classLevel || '').toUpperCase() !== 'S6') throw new Error('Only S6 students can be graduated from Promotions.');
    if (fromYear && toYear < fromYear) throw new Error('Graduation academic year cannot move backwards.');
    return 'graduated';
  }

  if (!destination) throw new Error('Destination class is required.');
  const fromLevel = String(student.classLevel || '').toUpperCase();
  const toLevel = String(destination.classLevel || '').toUpperCase();
  const fromIndex = CLASS_LEVELS.indexOf(fromLevel);
  const toIndex = CLASS_LEVELS.indexOf(toLevel);
  if (fromIndex < 0 || toIndex < 0) throw new Error('Student or destination class level is invalid.');
  if (toIndex < fromIndex) throw new Error('Promotion cannot move a student backwards to a lower class.');
  if (toIndex > fromIndex + 1) throw new Error('Promotion cannot skip more than one class level.');

  const samePlacement = String(student.classId || '') === String(destination._id || destination.classId || '');
  const sameYear = str(student.academicYear, 20) === toAcademicYear;
  const sameTerm = Number(student.term || 1) === toTerm;
  if (samePlacement && sameYear && sameTerm) return 'noop';

  if (toIndex === fromIndex) {
    if (fromYear && toYear === fromYear && toTerm <= Number(student.term || 1)) {
      throw new Error('Repeating/advancing within the same class must move to a later term or academic year.');
    }
    return fromYear && toYear > fromYear ? 'repeated' : 'advanced_term';
  }

  if (fromYear && toYear <= fromYear) {
    throw new Error('Moving to the next class requires a later academic year.');
  }
  return 'promoted';
}

function snapshotStudent(student) {
  const fields = [
    'schoolUnitId','schoolUnitName','schoolUnitCode','campusId','campusName','campusCode',
    'classId','className','classCode','section','stream','schoolLevel','classLevel','academicYear','term','status',
  ];
  const out = {};
  fields.forEach((field) => { out[field] = student[field]; });
  return out;
}

async function claimBatch(Student, ids, actorId = null, now = new Date(), ttlMs = 120000) {
  const cleanIds = [...new Set((ids || []).map(String).filter(isId))].slice(0, 200);
  if (!cleanIds.length) throw new Error('Select students to promote.');
  const token = promotionBatchId(now);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const claimed = [];
  try {
    for (const id of cleanIds.sort()) {
      // eslint-disable-next-line no-await-in-loop
      const student = await Student.findOneAndUpdate(
        {
          _id: id,
          isDeleted: { $ne: true },
          status: 'active',
          $or: [
            { promotionLeaseToken: { $in: [null, ''] } },
            { promotionLeaseToken: { $exists: false } },
            { promotionLeaseExpiresAt: { $lte: now } },
            { promotionLeaseExpiresAt: null },
          ],
        },
        { $set: { promotionLeaseToken: token, promotionLeaseExpiresAt: expiresAt, promotionLeaseBy: actorId || null } },
        { new: true },
      );
      if (!student) throw new Error('One or more selected students are unavailable, not Active, or busy with another promotion.');
      claimed.push(student);
    }
    return { token, expiresAt, students: claimed };
  } catch (err) {
    if (claimed.length) {
      await Student.updateMany(
        { _id: { $in: claimed.map((s) => s._id) }, promotionLeaseToken: token },
        { $set: { promotionLeaseToken: '', promotionLeaseExpiresAt: null, promotionLeaseBy: null } },
      ).catch(() => null);
    }
    throw err;
  }
}

async function releaseBatch(Student, ids, token) {
  if (!Student || !token || !ids?.length) return;
  await Student.updateMany(
    { _id: { $in: ids }, promotionLeaseToken: token },
    { $set: { promotionLeaseToken: '', promotionLeaseExpiresAt: null, promotionLeaseBy: null } },
  ).catch(() => null);
}

async function recountClassLearners(Student, Class, classIds) {
  if (!Student || !Class) return;
  for (const id of [...new Set((classIds || []).filter(isId).map(String))]) {
    // eslint-disable-next-line no-await-in-loop
    const count = await Student.countDocuments({ classId: id, isDeleted: { $ne: true }, status: { $nin: ['archived','graduated'] } });
    // eslint-disable-next-line no-await-in-loop
    await Class.updateOne({ _id: id }, { $set: { enrolledCount: count } }).catch(() => null);
  }
}

async function applyPromotionBatch(req, input = {}) {
  const { Student, PromotionLog, Class } = req.models || {};
  if (!Student || !PromotionLog || !Class) throw new Error('Promotion models are unavailable.');
  const toAcademicYear = normalizeAcademicYear(input.toAcademicYear);
  const toTerm = Number(input.toTerm);
  const toStatus = normalizePromotionStatus(input.toStatus || 'active');
  const destinationClass = input.destinationClass || null;
  if (!toAcademicYear) throw new Error('Enter a valid academic year, for example 2026/2027.');
  if (![1,2,3].includes(toTerm)) throw new Error('Destination term must be 1, 2 or 3.');
  if (!toStatus) throw new Error('Destination status is invalid.');

  if (toStatus !== 'graduated') {
    if (!destinationClass?._id) throw new Error('Destination class is required.');
    if (destinationClass.status !== 'active') throw new Error('Destination class must be Active.');
    if (destinationClass.academicYear && str(destinationClass.academicYear,20) !== toAcademicYear) {
      throw new Error('Destination class academic year does not match the requested academic year.');
    }
    if (destinationClass.term && Number(destinationClass.term) !== toTerm) {
      throw new Error('Destination class term does not match the requested term.');
    }
  }

  const actorId = input.actorId || null;
  const claimed = await claimBatch(Student, input.ids, actorId);
  const ids = claimed.students.map((s) => s._id);
  const batchId = claimed.token;
  const snapshots = new Map();
  const actions = new Map();
  const changed = [];
  const touchedClassIds = new Set();

  try {
    for (const student of claimed.students) {
      const action = progressionAction(student, destinationClass, { toAcademicYear, toTerm, toStatus });
      actions.set(String(student._id), action);
      snapshots.set(String(student._id), snapshotStudent(student));
      if (student.classId && isId(student.classId)) touchedClassIds.add(String(student.classId));
    }

    if (toStatus !== 'graduated' && destinationClass.capacity > 0) {
      const destId = String(destinationClass._id);
      const existing = await Student.countDocuments({
        classId: destId,
        _id: { $nin: ids },
        isDeleted: { $ne: true },
        status: { $nin: ['archived','graduated'] },
      });
      const incoming = claimed.students.filter((s) => actions.get(String(s._id)) !== 'noop').length;
      if (existing + incoming > Number(destinationClass.capacity)) {
        throw new Error(`Destination class capacity would be exceeded (${existing + incoming}/${destinationClass.capacity}).`);
      }
      touchedClassIds.add(destId);
    }

    for (const student of claimed.students) {
      const action = actions.get(String(student._id));
      if (action === 'noop') continue;
      const before = snapshots.get(String(student._id));
      if (toStatus !== 'graduated') {
        student.set({
          schoolUnitId: str(destinationClass.schoolUnitId,80), schoolUnitName: str(destinationClass.schoolUnitName,180), schoolUnitCode: str(destinationClass.schoolUnitCode,40),
          campusId: str(destinationClass.campusId,80), campusName: str(destinationClass.campusName,180), campusCode: str(destinationClass.campusCode,40),
          classId: String(destinationClass._id), className: str(destinationClass.name,180), classCode: str(destinationClass.code,40),
          section: str(destinationClass.sectionName || destinationClass.stream,40), stream: str(destinationClass.streamName || destinationClass.stream || destinationClass.sectionName,40),
          schoolLevel: str(destinationClass.levelType,30).toLowerCase(), classLevel: str(destinationClass.classLevel,30).toUpperCase(),
        });
      }
      student.academicYear = toAcademicYear;
      student.term = toTerm;
      // eslint-disable-next-line no-await-in-loop
      await applyStudentLifecycle(req, student, toStatus, { updatedBy: actorId });
      changed.push(student);

      // eslint-disable-next-line no-await-in-loop
      await PromotionLog.create({
        batchId,
        action,
        student: student._id,
        fromAcademicYear: str(before.academicYear,20), toAcademicYear,
        fromSemester: Number(before.term || 1), toSemester: toTerm,
        fromTerm: Number(before.term || 1), toTerm,
        fromYearLevel: str(before.classLevel,30), toYearLevel: str(student.classLevel,30),
        fromClassLevel: str(before.classLevel,30), toClassLevel: str(student.classLevel,30),
        fromSchoolLevel: str(before.schoolLevel,30), toSchoolLevel: str(student.schoolLevel,30),
        fromClassGroup: isId(before.classId) ? before.classId : null,
        toClassGroup: isId(student.classId) ? student.classId : null,
        fromClassId: str(before.classId,80), toClassId: str(student.classId,80),
        fromSection: str(before.section || before.stream,80), toSection: str(student.section || student.stream,80),
        fromStatus: str(before.status,40), toStatus,
        reason: str(input.reason,300),
        createdBy: actorId,
      });
    }

    await recountClassLearners(Student, Class, [...touchedClassIds]);
    return { batchId, changed: changed.length, skipped: claimed.students.length - changed.length };
  } catch (err) {
    await PromotionLog.deleteMany({ batchId }).catch(() => null);
    for (const student of [...changed].reverse()) {
      const before = snapshots.get(String(student._id));
      if (!before) continue;
      student.set(before);
      try {
        // eslint-disable-next-line no-await-in-loop
        await applyStudentLifecycle(req, student, before.status || 'active', { updatedBy: actorId });
      } catch (rollbackErr) {
        console.error('PROMOTION ROLLBACK ERROR:', rollbackErr);
      }
    }
    await recountClassLearners(Student, Class, [...touchedClassIds]).catch(() => null);
    throw err;
  } finally {
    await releaseBatch(Student, ids, batchId);
  }
}

module.exports = {
  CLASS_LEVELS,
  TARGET_STATUSES,
  normalizeAcademicYear,
  academicYearStart,
  normalizePromotionStatus,
  promotionBatchId,
  progressionAction,
  claimBatch,
  releaseBatch,
  recountClassLearners,
  applyPromotionBatch,
  csvCell,
};
