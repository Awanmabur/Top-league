const mongoose = require("mongoose");
const { safeExternalUrl } = require("../../src/services/tenant/studentSelfServiceService");

const oid = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const text = (v, max = 300) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const dateOrNull = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

async function hasCollection(conn, name) {
  const rows = await conn.db.listCollections({ name }, { nameOnly: true }).toArray().catch(() => []);
  return rows.length > 0;
}

function legacyJobStatus(v) {
  const x = String(v || "").toLowerCase();
  if (["open", "published", "active"].includes(x)) return "Published";
  if (["closed", "expired"].includes(x)) return "Closed";
  if (["archived", "deleted"].includes(x)) return "Archived";
  return "Draft";
}
function legacyJobType(v) {
  const x = String(v || "").toLowerCase();
  if (x.includes("intern")) return "Internship";
  if (x.includes("part")) return "Part-time";
  if (x.includes("full")) return "Full-time";
  if (x.includes("contract")) return "Contract";
  if (x.includes("graduate")) return "Graduate Program";
  return "Opportunity";
}
function legacyAppStatus(v) {
  const x = String(v || "").toLowerCase();
  return ({ submitted:"Submitted", pending:"Submitted", reviewing:"Reviewing", review:"Reviewing", shortlisted:"Shortlisted", interview:"Interview", accepted:"Accepted", approved:"Accepted", rejected:"Rejected", declined:"Rejected", withdrawn:"Withdrawn", cancelled:"Withdrawn" })[x] || "Submitted";
}
function legacyLetterStatus(v) {
  const x = String(v || "").toLowerCase();
  return ({ pending:"Pending", submitted:"Pending", review:"Pending", approved:"Approved", rejected:"Rejected", ready:"Ready", issued:"Ready", collected:"Collected", cancelled:"Cancelled", canceled:"Cancelled" })[x] || "Pending";
}

async function migrateLegacyJobs(models, stats) {
  const JobOpportunity = models?.JobOpportunity;
  const conn = JobOpportunity?.db;
  if (!JobOpportunity || !conn?.db) return;
  for (const collectionName of ["jobs", "opportunities"]) {
    if (!(await hasCollection(conn, collectionName))) continue;
    const rows = await conn.db.collection(collectionName).find({}).limit(10000).toArray();
    for (const row of rows) {
      const legacySourceId = `${collectionName}:${String(row._id)}`;
      if (await JobOpportunity.exists({ legacySourceId })) continue;
      const title = text(row.title || row.name, 180);
      const employer = text(row.employer || row.company || row.organisation || row.organization, 180);
      if (!title || !employer) { stats.legacyJobsSkipped += 1; continue; }
      const publishAt = dateOrNull(row.publishAt || row.publishedAt || row.createdAt);
      const deadline = dateOrNull(row.deadline || row.closingDate || row.expiresAt);
      let status = legacyJobStatus(row.status);
      if (status === "Published" && deadline && deadline < new Date()) status = "Closed";
      await JobOpportunity.create({
        title, employer, type: legacyJobType(row.type || row.jobType), location: text(row.location, 180),
        description: text(row.description || row.summary || "Legacy opportunity imported during migration.", 5000),
        requirements: text(row.requirements, 3000), externalApplyUrl: safeExternalUrl(row.externalApplyUrl || row.applyUrl || row.url),
        publishAt, deadline, status, eligibleClassLevels: Array.isArray(row.eligibleClassLevels) ? row.eligibleClassLevels.map((x) => text(x,20).toUpperCase()).filter(Boolean).slice(0,30) : [],
        legacySourceId, revision: 1, createdAt: row.createdAt || new Date(), updatedAt: row.updatedAt || new Date(),
      });
      stats.legacyJobsImported += 1;
    }
  }
}

async function migrateLegacyApplications(models, stats) {
  const { JobOpportunity, JobApplication } = models || {};
  const conn = JobApplication?.db;
  if (!JobOpportunity || !JobApplication || !conn?.db || !(await hasCollection(conn, "applications"))) return;
  const rows = await conn.db.collection("applications").find({}).limit(20000).toArray();
  for (const row of rows) {
    const legacySourceId = `applications:${String(row._id)}`;
    if (await JobApplication.exists({ legacySourceId })) continue;
    const studentId = row.studentId || row.student;
    const oldJobId = row.jobId || row.job || row.opportunityId || row.opportunity;
    if (!oid(studentId) || !oldJobId) { stats.legacyApplicationsSkipped += 1; continue; }
    let job = null;
    for (const prefix of ["jobs", "opportunities"]) {
      job = await JobOpportunity.findOne({ legacySourceId: `${prefix}:${String(oldJobId)}` }).select("_id").lean();
      if (job) break;
    }
    if (!job && oid(oldJobId)) job = await JobOpportunity.findById(oldJobId).select("_id").lean().catch(() => null);
    if (!job) { stats.legacyApplicationsSkipped += 1; continue; }
    const exists = await JobApplication.findOne({ jobId: job._id, studentId }).lean();
    if (exists) continue;
    await JobApplication.create({
      jobId: job._id, studentId, userId: oid(row.userId) ? row.userId : null, coverNote: text(row.coverNote || row.note, 2000),
      status: legacyAppStatus(row.status), submittedAt: dateOrNull(row.submittedAt || row.createdAt) || new Date(), legacySourceId, revision: 1,
      history: [], createdAt: row.createdAt || new Date(), updatedAt: row.updatedAt || new Date(),
    });
    stats.legacyApplicationsImported += 1;
  }
}

async function migrateStudentSelfService(models, { now = new Date() } = {}) {
  const { Student, CourseRegistration, RegistrationWindow, StudentHold, JobOpportunity, JobApplication, LetterRequest } = models || {};
  if (!Student || !CourseRegistration || !RegistrationWindow || !StudentHold || !JobOpportunity || !JobApplication || !LetterRequest) {
    throw new Error("Student self-service migration requires all canonical models.");
  }
  const stats = { expiredLeasesCleared:0, registrationsNormalized:0, windowsClosed:0, holdsCleared:0, jobsClosed:0, lettersNormalized:0, lettersRequiringReissue:0, legacyJobsImported:0, legacyJobsSkipped:0, legacyApplicationsImported:0, legacyApplicationsSkipped:0 };

  const lease = await Student.updateMany({ selfServiceLeaseToken: { $nin: ["", null] }, selfServiceLeaseExpiresAt: { $lte: now } }, { $set: { selfServiceLeaseToken:"", selfServiceLeaseExpiresAt:null, selfServiceLeaseBy:null } });
  stats.expiredLeasesCleared = lease.modifiedCount || 0;

  for (const [from, to] of [["submitted","pending"],["active","approved"],["registered","approved"],["declined","rejected"],["cancelled","dropped"]]) {
    const r = await CourseRegistration.updateMany({ status: from }, { $set: { status: to }, $inc: { revision: 1 } }).catch(() => ({ modifiedCount:0 }));
    stats.registrationsNormalized += r.modifiedCount || 0;
  }
  const win = await RegistrationWindow.updateMany({ status:"open", closesAt:{ $lt: now }, isDeleted:{ $ne:true } }, { $set:{ status:"closed" }, $inc:{ revision:1 } });
  stats.windowsClosed = win.modifiedCount || 0;
  const holds = await StudentHold.updateMany({ status:"active", expiresAt:{ $lte: now }, isDeleted:{ $ne:true } }, { $set:{ status:"cleared", clearedAt:now }, $inc:{ revision:1 } });
  stats.holdsCleared = holds.modifiedCount || 0;
  const jobs = await JobOpportunity.updateMany({ status:"Published", deadline:{ $lt: now }, isDeleted:{ $ne:true } }, { $set:{ status:"Closed" }, $inc:{ revision:1 } });
  stats.jobsClosed = jobs.modifiedCount || 0;

  const reissue = await LetterRequest.updateMany({
    status: { $in: ["Ready", "Collected"] },
    $or: [{ "issuedSnapshot.studentName": "" }, { "issuedSnapshot.studentName": { $exists: false } }],
    isDeleted: { $ne: true },
  }, { $set: { status: "Approved", readyAt: null, collectedAt: null }, $inc: { revision: 1 } });
  stats.lettersRequiringReissue = reissue.modifiedCount || 0;

  const rawLetterCollection = LetterRequest.collection;
  const legacyLetters = await rawLetterCollection.find({ status:{ $nin:["Pending","Approved","Rejected","Ready","Collected","Cancelled"] } }).limit(10000).toArray();
  for (const row of legacyLetters) {
    const status = legacyLetterStatus(row.status);
    await rawLetterCollection.updateOne({ _id: row._id }, { $set:{ status, revision: Math.max(1, Number(row.revision || 1)) } });
    stats.lettersNormalized += 1;
  }

  await migrateLegacyJobs(models, stats);
  await migrateLegacyApplications(models, stats);
  return stats;
}

module.exports = { migrateStudentSelfService, legacyJobStatus, legacyJobType, legacyAppStatus, legacyLetterStatus };
