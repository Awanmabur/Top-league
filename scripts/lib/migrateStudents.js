const crypto = require('crypto');

const clean = (v, max = 120) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const candidate = (year = new Date().getFullYear()) => `REG/${year}/${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

function normalizeLegacyStatus(value, isDeleted = false) {
  if (isDeleted === true) return 'archived';
  const key = clean(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (['active', 'enrolled'].includes(key)) return 'active';
  if (['on_hold', 'hold', 'held'].includes(key)) return 'on_hold';
  if (['suspended', 'blocked'].includes(key)) return 'suspended';
  if (['graduated', 'completed'].includes(key)) return 'graduated';
  if (['archived', 'deleted', 'inactive'].includes(key)) return 'archived';
  return 'active';
}

async function uniqueRegNo(Student, used, year) {
  for (let i = 0; i < 30; i += 1) {
    const value = candidate(year);
    if (used.has(value)) continue;
    if (!(await Student.collection.findOne({ regNo: value, isDeleted: { $ne: true } }, { projection: { _id: 1 } }))) {
      used.add(value);
      return value;
    }
  }
  throw new Error('Unable to allocate migrated registration number.');
}

async function migrateStudents(models = {}) {
  const { Student, User, Parent } = models;
  if (!Student) {
    return {
      scanned: 0,
      normalized: 0,
      repairedRegNos: 0,
      repairedStudentNos: 0,
      duplicateUserLinksCleared: 0,
      authLinksBackfilled: 0,
      staleUserStudentLinksCleared: 0,
      parentLinksRepaired: 0,
      parentUserLinksRepaired: 0,
      lifecycleSuspensionsBackfilled: 0,
    };
  }

  const rows = await Student.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const usedRegNos = new Set();
  const usedStudentNos = new Set();
  const acceptedUserToStudent = new Map();
  let normalized = 0;
  let repairedRegNos = 0;
  let repairedStudentNos = 0;
  let duplicateUserLinksCleared = 0;
  let authLinksBackfilled = 0;
  let staleUserStudentLinksCleared = 0;
  let parentLinksRepaired = 0;
  let parentUserLinksRepaired = 0;
  let lifecycleSuspensionsBackfilled = 0;

  for (const row of rows) {
    const patch = {};
    const deleted = row.isDeleted === true;
    if (typeof row.isDeleted !== 'boolean') patch.isDeleted = false;

    const status = normalizeLegacyStatus(row.status, deleted);
    if (row.status !== status) patch.status = status;

    const normalizedEmail = clean(row.email, 120).toLowerCase();
    const normalizedGuardianEmail = clean(row.guardianEmail, 120).toLowerCase();
    if (normalizedEmail && normalizedEmail !== row.email) patch.email = normalizedEmail;
    if (normalizedGuardianEmail && normalizedGuardianEmail !== row.guardianEmail) patch.guardianEmail = normalizedGuardianEmail;

    let regNo = clean(row.regNo, 60);
    if (!deleted && (!regNo || usedRegNos.has(regNo))) {
      if (regNo) patch.legacyRegNo = clean(row.legacyRegNo || regNo, 120);
      regNo = await uniqueRegNo(Student, usedRegNos, new Date(row.createdAt || Date.now()).getFullYear());
      patch.regNo = regNo;
      repairedRegNos += 1;
    } else if (!deleted && regNo) {
      usedRegNos.add(regNo);
    }

    let studentNo = clean(row.studentNo, 60);
    if (!deleted && studentNo) {
      if (usedStudentNos.has(studentNo)) {
        patch.legacyStudentNo = clean(row.legacyStudentNo || studentNo, 120);
        patch.studentNo = '';
        studentNo = '';
        repairedStudentNos += 1;
      } else {
        usedStudentNos.add(studentNo);
      }
    }

    if (!deleted && row.userId) {
      const key = String(row.userId);
      if (acceptedUserToStudent.has(key)) {
        patch.userId = null;
        duplicateUserLinksCleared += 1;
      } else {
        acceptedUserToStudent.set(key, String(row._id));
      }
    }

    if (Object.keys(patch).length) {
      await Student.collection.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }

  if (User) {
    // First make every already-accepted Student.userId authoritative on the User side.
    for (const [userId, studentId] of acceptedUserToStudent.entries()) {
      const user = await User.findOne({ _id: userId, deletedAt: null })
        .select('_id studentId status studentAccessSuspended studentAccessPreviousStatus')
        .lean()
        .catch(() => null);
      if (!user) continue;
      const student = await Student.findOne({ _id: studentId, isDeleted: { $ne: true } })
        .select('_id status')
        .lean()
        .catch(() => null);
      if (!student) continue;

      const set = {};
      const inc = {};
      if (String(user.studentId || '') !== String(student._id)) {
        set.studentId = student._id;
        authLinksBackfilled += 1;
      }
      if (['suspended', 'archived'].includes(String(student.status || '')) && user.status !== 'suspended') {
        set.studentAccessPreviousStatus = ['invited', 'active'].includes(user.status) ? user.status : 'active';
        set.studentAccessSuspended = true;
        set.status = 'suspended';
        inc.tokenVersion = 1;
        lifecycleSuspensionsBackfilled += 1;
      }
      if (Object.keys(set).length || Object.keys(inc).length) {
        const update = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(inc).length) update.$inc = inc;
        await User.updateOne({ _id: user._id, deletedAt: null }, update);
      }
    }

    // Reconcile stale User.studentId pointers without reintroducing duplicate Student.userId links.
    const studentUsers = await User.find({ roles: 'student', deletedAt: null })
      .select('_id email studentId')
      .lean();
    for (const user of studentUsers) {
      if (user.studentId) {
        const mappedStudentId = acceptedUserToStudent.get(String(user._id));
        if (mappedStudentId) {
          if (String(user.studentId) !== mappedStudentId) {
            await User.updateOne({ _id: user._id }, { $set: { studentId: mappedStudentId }, $inc: { tokenVersion: 1 } });
            authLinksBackfilled += 1;
          }
          continue;
        }

        const linked = await Student.findOne({ _id: user.studentId, isDeleted: { $ne: true } })
          .select('_id userId')
          .lean()
          .catch(() => null);
        if (!linked || (linked.userId && String(linked.userId) !== String(user._id))) {
          await User.updateOne({ _id: user._id }, { $set: { studentId: null }, $inc: { tokenVersion: 1 } });
          staleUserStudentLinksCleared += 1;
          continue;
        }
        if (!linked.userId) {
          await Student.updateOne({ _id: linked._id, userId: null }, { $set: { userId: user._id } });
          acceptedUserToStudent.set(String(user._id), String(linked._id));
          authLinksBackfilled += 1;
        }
        continue;
      }

      const email = clean(user.email, 120).toLowerCase();
      if (!email) continue;
      const student = await Student.findOne({ email, isDeleted: { $ne: true }, userId: null })
        .select('_id')
        .lean()
        .catch(() => null);
      if (!student) continue;
      await Student.updateOne({ _id: student._id, userId: null }, { $set: { userId: user._id } });
      await User.updateOne({ _id: user._id, studentId: null }, { $set: { studentId: student._id } });
      acceptedUserToStudent.set(String(user._id), String(student._id));
      authLinksBackfilled += 1;
    }

    // Parent portal authorization also exists on User.childrenStudentIds; remove deleted/stale children there.
    const parentUsers = await User.find({ roles: 'parent', deletedAt: null })
      .select('_id childrenStudentIds')
      .lean();
    for (const user of parentUsers) {
      const valid = [];
      for (const id of user.childrenStudentIds || []) {
        if (await Student.exists({ _id: id, isDeleted: { $ne: true } })) valid.push(id);
      }
      if (valid.length !== (user.childrenStudentIds || []).length) {
        await User.updateOne(
          { _id: user._id },
          { $set: { childrenStudentIds: valid }, $inc: { tokenVersion: 1 } },
        );
        parentUserLinksRepaired += 1;
      }
    }
  }

  if (Parent) {
    const parents = await Parent.find({}).select('_id userId childrenStudentIds').lean();
    for (const parent of parents) {
      const valid = [];
      for (const id of parent.childrenStudentIds || []) {
        if (await Student.exists({ _id: id, isDeleted: { $ne: true } })) valid.push(id);
      }
      if (valid.length !== (parent.childrenStudentIds || []).length) {
        await Parent.updateOne({ _id: parent._id }, { $set: { childrenStudentIds: valid } });
        parentLinksRepaired += 1;
      }
    }
  }

  return {
    scanned: rows.length,
    normalized,
    repairedRegNos,
    repairedStudentNos,
    duplicateUserLinksCleared,
    authLinksBackfilled,
    staleUserStudentLinksCleared,
    parentLinksRepaired,
    parentUserLinksRepaired,
    lifecycleSuspensionsBackfilled,
  };
}

module.exports = { migrateStudents, normalizeLegacyStatus };
