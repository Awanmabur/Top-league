const crypto = require('crypto');
const mongoose = require('mongoose');
const { invalidateTenantUserCache } = require('../../middleware/tenant/requireTenantAuth');

const STUDENT_STATUSES = Object.freeze(['active', 'on_hold', 'suspended', 'graduated', 'archived']);
const STUDENT_STATUS_SET = new Set(STUDENT_STATUSES);

const str = (v, max = 2000) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const email = (v) => str(v, 120).toLowerCase();
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

function normalizeStudentStatus(value, fallback = null) {
  const status = str(value, 30).toLowerCase();
  if (STUDENT_STATUS_SET.has(status)) return status;
  return fallback;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function randomToken(bytes = 5) {
  return crypto.randomBytes(bytes).toString('hex').toUpperCase();
}

function emergencyRegNo(year = new Date().getFullYear()) {
  return `REG/${year}/${randomToken(4)}`;
}

async function allocateUniqueRegNo(Student, candidateFactory, attempts = 12) {
  if (!Student) throw new Error('Student model is required.');
  for (let i = 0; i < attempts; i += 1) {
    const candidate = str(await candidateFactory(i), 60);
    if (!candidate) continue;
    const exists = await Student.exists({ regNo: candidate, isDeleted: { $ne: true } });
    if (!exists) return candidate;
  }
  for (let i = 0; i < attempts; i += 1) {
    const candidate = emergencyRegNo();
    const exists = await Student.exists({ regNo: candidate, isDeleted: { $ne: true } });
    if (!exists) return candidate;
  }
  throw new Error('Could not allocate a unique student registration number.');
}

function lifecycleDisablesAccess(status, deleting = false) {
  return deleting || ['suspended', 'archived'].includes(normalizeStudentStatus(status, ''));
}

function lifecycleEnablesAccess(status) {
  return ['active', 'on_hold', 'graduated'].includes(normalizeStudentStatus(status, ''));
}

async function syncStudentUserAccess(req, student, nextStatus, { deleting = false } = {}) {
  const User = req.models?.User;
  const userId = student?.userId?._id || student?.userId;
  if (!User || !userId || !isId(userId)) return;

  const user = await User.findOne({ _id: userId, deletedAt: null })
    .select('_id status studentAccessSuspended studentAccessPreviousStatus studentId')
    .lean();
  if (!user) return;

  if (lifecycleDisablesAccess(nextStatus, deleting)) {
    if (user.status === 'suspended' && user.studentAccessSuspended !== true) return;

    const set = { studentAccessSuspended: true };
    const update = { $set: set };
    if (user.status !== 'suspended') {
      set.studentAccessPreviousStatus = ['invited', 'active'].includes(user.status) ? user.status : 'active';
      set.status = 'suspended';
      update.$inc = { tokenVersion: 1 };
    }
    await User.updateOne({ _id: userId, deletedAt: null }, update);
    invalidateTenantUserCache(req.tenant?.code, String(userId));
    return;
  }

  if (lifecycleEnablesAccess(nextStatus) && user.studentAccessSuspended === true) {
    const restoredStatus = ['invited', 'active'].includes(user.studentAccessPreviousStatus)
      ? user.studentAccessPreviousStatus
      : 'active';
    await User.updateOne(
      { _id: userId, deletedAt: null, studentAccessSuspended: true },
      {
        $set: { status: restoredStatus, studentAccessSuspended: false, studentAccessPreviousStatus: null },
        $inc: { tokenVersion: 1 },
      },
    );
    invalidateTenantUserCache(req.tenant?.code, String(userId));
  }
}

async function detachStudentFromParents(req, studentId, guardianUserId = null) {
  const { User, Parent } = req.models || {};
  if (!studentId) return;
  const oid = isId(studentId) ? new mongoose.Types.ObjectId(String(studentId)) : studentId;
  const impacted = new Set();

  if (User) {
    const linkedUsers = await User.find({ childrenStudentIds: oid, deletedAt: null }).select('_id').lean().catch(() => []);
    linkedUsers.forEach((row) => impacted.add(String(row._id)));
    if (guardianUserId && isId(guardianUserId)) impacted.add(String(guardianUserId));
    await User.updateMany(
      { childrenStudentIds: oid, deletedAt: null },
      { $pull: { childrenStudentIds: oid }, $inc: { tokenVersion: 1 } },
    ).catch(() => null);
  }
  if (Parent) {
    const linkedParents = await Parent.find({ childrenStudentIds: oid }).select('userId').lean().catch(() => []);
    linkedParents.forEach((row) => { if (row.userId) impacted.add(String(row.userId)); });
    await Parent.updateMany(
      { childrenStudentIds: oid },
      { $pull: { childrenStudentIds: oid } },
    ).catch(() => null);
  }
  impacted.forEach((userId) => invalidateTenantUserCache(req.tenant?.code, userId));
}

async function syncStudentIdentityLinks(req, student, previous = {}) {
  const { User, Parent } = req.models || {};
  if (!student?._id) return;

  const studentUserId = student.userId?._id || student.userId;
  if (User && studentUserId && isId(studentUserId)) {
    const patch = {
      studentId: student._id,
      firstName: str(student.firstName || student.fullName?.split(' ')[0] || 'Student', 80),
      lastName: str(student.lastName || student.fullName?.split(' ').slice(1).join(' ') || 'Account', 80),
    };
    if (email(student.email)) patch.email = email(student.email);
    if (str(student.phone, 40)) patch.phone = str(student.phone, 40);
    await User.updateOne({ _id: studentUserId, deletedAt: null }, { $set: patch });
    invalidateTenantUserCache(req.tenant?.code, String(studentUserId));
  }

  const previousGuardianUserId = previous.guardianUserId?._id || previous.guardianUserId || null;
  const guardianUserId = student.guardianUserId?._id || student.guardianUserId || null;
  if (previousGuardianUserId && String(previousGuardianUserId) !== String(guardianUserId || '')) {
    const oid = new mongoose.Types.ObjectId(String(student._id));
    await User?.updateOne({ _id: previousGuardianUserId, deletedAt: null }, { $pull: { childrenStudentIds: oid }, $inc: { tokenVersion: 1 } }).catch(() => null);
    await Parent?.updateOne({ userId: previousGuardianUserId }, { $pull: { childrenStudentIds: oid } }).catch(() => null);
    invalidateTenantUserCache(req.tenant?.code, String(previousGuardianUserId));
  }

  if (guardianUserId && isId(guardianUserId)) {
    const oid = new mongoose.Types.ObjectId(String(student._id));
    const guardianPatch = {};
    if (email(student.guardianEmail)) guardianPatch.email = email(student.guardianEmail);
    if (str(student.guardianPhone, 40)) guardianPatch.phone = str(student.guardianPhone, 40);
    if (Object.keys(guardianPatch).length) {
      await User?.updateOne({ _id: guardianUserId, deletedAt: null }, { $set: guardianPatch }).catch(() => null);
    }
    await User?.updateOne(
      { _id: guardianUserId, deletedAt: null, childrenStudentIds: { $ne: oid } },
      { $addToSet: { childrenStudentIds: oid }, $inc: { tokenVersion: 1 } },
    ).catch(() => null);

    const guardianName = str(student.guardianName, 120);
    const parts = guardianName.split(' ').filter(Boolean);
    const parentPatch = {
      userId: guardianUserId,
      firstName: parts[0] || 'Parent',
      lastName: parts.slice(1).join(' '),
      email: email(student.guardianEmail),
      phone: str(student.guardianPhone, 40),
      status: 'active',
    };
    if (Parent && parentPatch.email) {
      await Parent.findOneAndUpdate(
        { $or: [{ userId: guardianUserId }, { email: parentPatch.email }] },
        { $set: parentPatch, $addToSet: { childrenStudentIds: oid } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).catch(() => null);
    }
    invalidateTenantUserCache(req.tenant?.code, String(guardianUserId));
  }
}

async function applyStudentLifecycle(req, student, nextStatus, options = {}) {
  const status = normalizeStudentStatus(nextStatus);
  if (!status) throw new Error('Invalid student status.');
  student.status = status;
  if (status !== 'on_hold') {
    student.holdType = '';
    student.holdReason = '';
    student.holdUntil = null;
  }
  if (options.deleting) {
    student.isDeleted = true;
    student.deletedAt = options.deletedAt || new Date();
    student.status = 'archived';
  }
  if (options.updatedBy) student.updatedBy = options.updatedBy;
  await student.save();
  await syncStudentUserAccess(req, student, student.status, { deleting: !!options.deleting });
  if (options.deleting) await detachStudentFromParents(req, student._id, student.guardianUserId);
  return student;
}

function duplicateKeyField(err, field) {
  if (!err || Number(err.code) !== 11000) return false;
  if (err.keyPattern && Object.prototype.hasOwnProperty.call(err.keyPattern, field)) return true;
  if (err.keyValue && Object.prototype.hasOwnProperty.call(err.keyValue, field)) return true;
  return String(err.message || '').includes(field);
}

async function createStudentWithRegRetry(Student, payload, regenerateRegNo, options = {}) {
  if (!Student) throw new Error('Student model is required.');
  const attempts = Math.max(1, Math.min(Number(options.attempts || 8), 20));
  let nextPayload = { ...payload };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await Student.create(nextPayload);
    } catch (err) {
      if (!options.autoGeneratedRegNo || !duplicateKeyField(err, 'regNo') || attempt === attempts - 1) throw err;
      const replacement = str(await regenerateRegNo(attempt + 1), 60);
      if (!replacement) throw err;
      nextPayload = { ...nextPayload, regNo: replacement };
    }
  }
  throw new Error('Could not create student with a unique registration number.');
}

module.exports = {
  STUDENT_STATUSES,
  normalizeStudentStatus,
  csvCell,
  emergencyRegNo,
  allocateUniqueRegNo,
  syncStudentUserAccess,
  syncStudentIdentityLinks,
  detachStudentFromParents,
  applyStudentLifecycle,
  duplicateKeyField,
  createStudentWithRegRetry,
};
