const mongoose = require('mongoose');

const str = (v, max = 120) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

function inferAction(row = {}) {
  const toStatus = str(row.toStatus, 40).toLowerCase();
  if (toStatus === 'graduated') return 'graduated';
  const fromLevel = str(row.fromClassLevel || row.fromYearLevel, 30).toUpperCase();
  const toLevel = str(row.toClassLevel || row.toYearLevel, 30).toUpperCase();
  const fromYear = str(row.fromAcademicYear, 20);
  const toYear = str(row.toAcademicYear, 20);
  const fromTerm = Number(row.fromTerm || row.fromSemester || 1);
  const toTerm = Number(row.toTerm || row.toSemester || 1);
  if (fromLevel && toLevel && fromLevel === toLevel) {
    if (fromYear && toYear && fromYear !== toYear) return 'repeated';
    if (toTerm !== fromTerm) return 'advanced_term';
    return 'advanced_term';
  }
  return 'promoted';
}

async function migratePromotions(models = {}, now = new Date()) {
  const { PromotionLog, Student } = models;
  let logsScanned = 0;
  let logsNormalized = 0;
  let expiredLeasesCleared = 0;

  if (PromotionLog) {
    const cursor = PromotionLog.collection.find({});
    while (await cursor.hasNext()) {
      const row = await cursor.next();
      logsScanned += 1;
      const set = {};
      const batchId = str(row.batchId, 80);
      if (!batchId) set.batchId = `LEGACY-${String(row._id)}`.slice(0, 80);
      const action = inferAction(row);
      if (!['promoted', 'advanced_term', 'repeated', 'graduated'].includes(row.action)) set.action = action;

      const fromTerm = Number(row.fromTerm || row.fromSemester || 0);
      const toTerm = Number(row.toTerm || row.toSemester || 0);
      if (!Number.isInteger(row.fromTerm) && fromTerm >= 1 && fromTerm <= 3) set.fromTerm = fromTerm;
      if (!Number.isInteger(row.toTerm) && toTerm >= 1 && toTerm <= 3) set.toTerm = toTerm;

      const fromLevel = str(row.fromClassLevel || row.fromYearLevel, 30).toUpperCase();
      const toLevel = str(row.toClassLevel || row.toYearLevel, 30).toUpperCase();
      if (!str(row.fromClassLevel, 30) && fromLevel) set.fromClassLevel = fromLevel;
      if (!str(row.toClassLevel, 30) && toLevel) set.toClassLevel = toLevel;

      if (!str(row.fromClassId, 80) && isId(row.fromClassGroup)) set.fromClassId = String(row.fromClassGroup);
      if (!str(row.toClassId, 80) && isId(row.toClassGroup)) set.toClassId = String(row.toClassGroup);

      if (Object.keys(set).length) {
        await PromotionLog.collection.updateOne({ _id: row._id }, { $set: set });
        logsNormalized += 1;
      }
    }
  }

  if (Student) {
    const result = await Student.updateMany(
      {
        promotionLeaseToken: { $nin: [null, ''] },
        promotionLeaseExpiresAt: { $lte: now },
      },
      { $set: { promotionLeaseToken: '', promotionLeaseExpiresAt: null, promotionLeaseBy: null } },
    );
    expiredLeasesCleared = Number(result.modifiedCount || result.nModified || 0);
  }

  return { logsScanned, logsNormalized, expiredLeasesCleared };
}

module.exports = { migratePromotions, inferAction };
