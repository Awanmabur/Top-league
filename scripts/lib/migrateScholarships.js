const svc = require("../../src/services/tenant/scholarshipService");

async function migrateScholarships(models = {}) {
  const { Scholarship, ScholarshipApplication } = models;
  let scholarships = 0, applications = 0, applicantKeys = 0, duplicateKeysAdjusted = 0, timestamps = 0;
  if (Scholarship) {
    const rows = await Scholarship.find({}).select("_id studentId recordKind type value status startDate endDate").lean();
    scholarships = rows.length;
    for (const row of rows) {
      const patch = {};
      const kind = row.studentId ? "Award" : "Program";
      if (row.recordKind !== kind) patch.recordKind = kind;
      if (row.type === "Full" && Number(row.value || 0) !== 100) patch.value = 100;
      if (!svc.SCHOLARSHIP_STATUSES.includes(row.status)) patch.status = "Inactive";
      if (Object.keys(patch).length) await Scholarship.updateOne({ _id: row._id }, { $set: patch });
    }
  }

  if (ScholarshipApplication) {
    const rows = await ScholarshipApplication.find({}).sort({ createdAt: 1, _id: 1 }).lean();
    applications = rows.length;
    const seen = new Set();
    for (const row of rows) {
      const patch = {};
      let key = svc.applicantKey(row);
      if (!key) key = `legacy:${row._id}`;
      const composite = `${row.scholarship}:${key}`;
      if (seen.has(composite)) { key = `legacy:${row._id}`; duplicateKeysAdjusted += 1; }
      seen.add(`${row.scholarship}:${key}`);
      if (row.applicantKey !== key) { patch.applicantKey = key; applicantKeys += 1; }
      const at = row.updatedAt || row.createdAt || new Date();
      if (row.status === "under_review" && !row.reviewedAt) { patch.reviewedAt = at; timestamps += 1; }
      if (row.status === "shortlisted" && !row.shortlistedAt) { patch.shortlistedAt = at; timestamps += 1; }
      if (row.status === "awarded" && !row.awardedAt) { patch.awardedAt = at; timestamps += 1; }
      if (row.status === "rejected" && !row.rejectedAt) { patch.rejectedAt = at; timestamps += 1; }
      if (row.status === "withdrawn" && !row.withdrawnAt) { patch.withdrawnAt = at; timestamps += 1; }
      if (!svc.APPLICATION_STATUSES.includes(row.status)) patch.status = "submitted";
      if (Object.keys(patch).length) await ScholarshipApplication.updateOne({ _id: row._id }, { $set: patch });
    }
  }
  return { scholarships, applications, applicantKeys, duplicateKeysAdjusted, timestamps };
}

module.exports = { migrateScholarships };
