const {
  allocateApplicationId,
  allocateOfferLetterNo,
  documentCompleteness,
  normalizeChecklist,
  normalizeInterviewMode,
  normalizeStatus,
  sanitizeTags,
} = require("../../src/services/tenant/admissionsService");

function text(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

async function repairDuplicateField(Model, rows, field, allocator) {
  if (!Model) return 0;
  const active = rows.filter((row) => row.isDeleted !== true);
  const counts = new Map();
  active.forEach((row) => {
    const value = text(row[field], 100);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  const kept = new Set();
  let repaired = 0;
  for (const row of active) {
    const value = text(row[field], 100);
    const duplicate = value && (counts.get(value) || 0) > 1;
    if (value && (!duplicate || !kept.has(value))) {
      kept.add(value);
      continue;
    }
    const replacement = await allocator(Model, row.createdAt || new Date());
    await Model.updateOne({ _id: row._id }, { $set: { [field]: replacement } });
    repaired += 1;
  }
  return repaired;
}

async function migrateAdmissions(models = {}) {
  const { Applicant, OfferLetter } = models;
  const applicants = Applicant ? await Applicant.find({}).sort({ createdAt: 1, _id: 1 }).lean() : [];
  const letters = OfferLetter ? await OfferLetter.find({}).sort({ createdAt: 1, _id: 1 }).lean() : [];

  const repairedApplicationIds = await repairDuplicateField(Applicant, applicants, "applicationId", allocateApplicationId);
  const repairedLetterNumbers = await repairDuplicateField(OfferLetter, letters, "letterNo", allocateOfferLetterNo);
  let normalizedApplicants = 0;

  for (const applicant of applicants) {
    if (applicant.isDeleted === true) continue;
    const patch = {};
    const checklist = normalizeChecklist(applicant.reviewChecklist || {});
    if (JSON.stringify(checklist) !== JSON.stringify(applicant.reviewChecklist || {})) patch.reviewChecklist = checklist;
    const tags = sanitizeTags(applicant.tags || []);
    if (JSON.stringify(tags) !== JSON.stringify(applicant.tags || [])) patch.tags = tags;
    const status = normalizeStatus(applicant.status);
    if (status !== applicant.status) patch.status = status;
    if (applicant.interviewMode) {
      const mode = normalizeInterviewMode(applicant.interviewMode);
      if (mode !== applicant.interviewMode) patch.interviewMode = mode;
    }
    const lockAt = applicant.conversionLockAt ? new Date(applicant.conversionLockAt) : null;
    const staleLock = lockAt && !Number.isNaN(lockAt.getTime()) && lockAt.getTime() < Date.now() - (15 * 60 * 1000);
    if (applicant.status === "converted" || staleLock) {
      patch.conversionLockToken = "";
      patch.conversionLockAt = null;
      patch.conversionLockBy = null;
    }
    const stats = documentCompleteness(applicant);
    if (applicant.reviewChecklist?.documentsComplete === true && stats.uploaded < stats.total) {
      patch["reviewChecklist.documentsComplete"] = false;
    }
    if (Object.keys(patch).length) {
      await Applicant.updateOne({ _id: applicant._id }, { $set: patch });
      normalizedApplicants += 1;
    }
  }

  return {
    applicantsScanned: applicants.length,
    lettersScanned: letters.length,
    normalizedApplicants,
    repairedApplicationIds,
    repairedLetterNumbers,
  };
}

module.exports = { migrateAdmissions, repairDuplicateField };
