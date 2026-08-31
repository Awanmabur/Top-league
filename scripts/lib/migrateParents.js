const mongoose = require('mongoose');

const clean = (v, max = 120) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const emailKey = (v) => clean(v, 120).toLowerCase();
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

function normalizeLegacyStatus(value) {
  const status = clean(value, 30).toLowerCase();
  if (['active', 'on_hold', 'suspended', 'archived'].includes(status)) return status;
  if (status === 'pending') return 'on_hold';
  if (status === 'inactive') return 'archived';
  return 'on_hold';
}

async function dropLegacyParentIndexes(Parent) {
  const indexes = await Parent.collection.indexes().catch(() => []);
  for (const index of indexes) {
    if (index.name === '_id_') continue;
    const keys = index.key || {};
    const isEmail = Object.keys(keys).length === 1 && keys.email === 1;
    const isUser = Object.keys(keys).length === 1 && keys.userId === 1;
    if ((isEmail || isUser) && !index.partialFilterExpression) {
      await Parent.collection.dropIndex(index.name).catch((err) => {
        if (!['IndexNotFound', 27].includes(err?.codeName) && err?.code !== 27) throw err;
      });
    }
  }
}

async function migrateParents(models = {}) {
  const { Parent, User, Student } = models;
  if (!Parent) return { scanned: 0, normalized: 0, mergedDuplicates: 0, userLinksBackfilled: 0, profilesCreated: 0, childLinksPruned: 0 };

  await dropLegacyParentIndexes(Parent);
  const rows = await Parent.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  let normalized = 0;
  let mergedDuplicates = 0;
  let userLinksBackfilled = 0;
  let profilesCreated = 0;
  let childLinksPruned = 0;

  const byEmail = new Map();
  const usedUsers = new Map();

  for (const row of rows) {
    const patch = {};
    const email = emailKey(row.email);
    const status = normalizeLegacyStatus(row.status);
    if (row.status !== status) patch.status = status;
    if (row.isDeleted !== true && row.isDeleted !== false) patch.isDeleted = false;
    if (email && row.email !== email) patch.email = email;
    if (row.addressLine1 == null) patch.addressLine1 = '';
    if (row.addressLine2 == null) patch.addressLine2 = '';
    if (row.city == null) patch.city = '';
    if (row.country == null) patch.country = '';
    if (row.occupation == null) patch.occupation = '';
    if (row.notes == null) patch.notes = '';

    if (row.isDeleted !== true && email) {
      const keeper = byEmail.get(email);
      if (keeper) {
        const mergedKids = Array.from(new Set([...(keeper.childrenStudentIds || []), ...(row.childrenStudentIds || [])].map(String).filter(isId)));
        await Parent.collection.updateOne({ _id: keeper._id }, { $set: { childrenStudentIds: mergedKids.map((id) => new mongoose.Types.ObjectId(id)) } });
        patch.status = 'archived';
        patch.isDeleted = true;
        patch.deletedAt = row.deletedAt || new Date();
        patch.userId = null;
        patch.childrenStudentIds = [];
        patch.notes = clean(`${row.notes || ''} Legacy duplicate merged during Parent migration.`, 1200);
        mergedDuplicates += 1;
      } else {
        byEmail.set(email, row);
      }
    }

    if (row.isDeleted !== true && row.userId && isId(row.userId) && patch.isDeleted !== true) {
      const userKey = String(row.userId);
      const previous = usedUsers.get(userKey);
      if (previous) {
        patch.userId = null;
      } else {
        usedUsers.set(userKey, row._id);
      }
    }

    if (Object.keys(patch).length) {
      await Parent.collection.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }

  if (Student) {
    const parents = await Parent.find({ isDeleted: { $ne: true } }).select('_id childrenStudentIds').lean();
    for (const parent of parents) {
      const ids = Array.from(new Set((parent.childrenStudentIds || []).map(String).filter(isId)));
      const validRows = ids.length ? await Student.find({ _id: { $in: ids }, isDeleted: { $ne: true }, status: { $ne: 'archived' } }).select('_id').lean() : [];
      const valid = validRows.map((row) => String(row._id));
      if (valid.length !== ids.length) {
        await Parent.updateOne({ _id: parent._id }, { $set: { childrenStudentIds: valid } });
        childLinksPruned += 1;
      }
    }
  }

  if (User) {
    const activeParents = await Parent.find({ isDeleted: { $ne: true } }).select('_id userId email firstName lastName phone status childrenStudentIds').lean();
    const linkedUsers = new Set(activeParents.map((p) => String(p.userId || '')).filter(Boolean));
    for (const parent of activeParents) {
      let user = null;
      if (parent.userId) {
        user = await User.findOne({ _id: parent.userId, deletedAt: null }).select('_id roles status tokenVersion childrenStudentIds parentAccessSuspended parentAccessPreviousStatus').lean().catch(() => null);
      }
      if (!user && parent.email) {
        user = await User.findOne({ email: emailKey(parent.email), deletedAt: null, roles: 'parent' }).select('_id roles status tokenVersion childrenStudentIds parentAccessSuspended parentAccessPreviousStatus').lean().catch(() => null);
        if (user && !linkedUsers.has(String(user._id))) {
          await Parent.updateOne({ _id: parent._id }, { $set: { userId: user._id } });
          linkedUsers.add(String(user._id));
          userLinksBackfilled += 1;
        } else if (user && linkedUsers.has(String(user._id))) {
          user = null;
        }
      }
      if (user) {
        const children = Array.from(new Set((parent.childrenStudentIds || []).map(String).filter(isId)));
        const set = { childrenStudentIds: children };
        const inc = {};
        if (['suspended', 'archived'].includes(parent.status)) {
          // Never claim ownership of an account that was already manually/security suspended.
          if (user.status !== 'suspended') {
            set.parentAccessPreviousStatus = ['invited', 'active'].includes(user.status) ? user.status : 'active';
            set.parentAccessSuspended = true;
            set.status = 'suspended';
            inc.tokenVersion = 1;
          }
        } else if (['active', 'on_hold'].includes(parent.status) && user.parentAccessSuspended === true) {
          set.status = ['invited', 'active'].includes(user.parentAccessPreviousStatus) ? user.parentAccessPreviousStatus : 'active';
          set.parentAccessSuspended = false;
          set.parentAccessPreviousStatus = null;
          inc.tokenVersion = 1;
        }
        const update = { $set: set };
        if (inc.tokenVersion) update.$inc = inc;
        await User.updateOne({ _id: user._id, deletedAt: null }, update);
      }
    }

    const parentUsers = await User.find({ deletedAt: null, roles: 'parent' }).select('_id email firstName lastName phone status childrenStudentIds').lean();
    for (const user of parentUsers) {
      if (linkedUsers.has(String(user._id))) continue;
      const email = emailKey(user.email);
      if (!email) continue;
      const existing = await Parent.findOne({ email, isDeleted: { $ne: true } }).select('_id userId').lean();
      if (existing) {
        if (!existing.userId) {
          await Parent.updateOne({ _id: existing._id }, { $set: { userId: user._id } });
          linkedUsers.add(String(user._id));
          userLinksBackfilled += 1;
        }
        continue;
      }
      await Parent.create({
        userId: user._id,
        firstName: clean(user.firstName, 80) || 'Parent',
        lastName: clean(user.lastName, 80),
        email,
        phone: clean(user.phone, 40),
        childrenStudentIds: (user.childrenStudentIds || []).filter(isId),
        relationship: 'Guardian',
        status: user.status === 'active' ? 'active' : user.status === 'invited' ? 'on_hold' : 'suspended',
        isDeleted: false,
      });
      linkedUsers.add(String(user._id));
      profilesCreated += 1;
    }
  }

  return { scanned: rows.length, normalized, mergedDuplicates, userLinksBackfilled, profilesCreated, childLinksPruned };
}

module.exports = { migrateParents, normalizeLegacyStatus, dropLegacyParentIndexes };
