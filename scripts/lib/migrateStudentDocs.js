const { normalizeStudentDocType } = require("../../src/utils/studentDocs");
const { normalizeDocumentStatus, safeStoredUrl, effectiveDocumentStatus } = require("../../src/services/tenant/studentDocumentService");
const str = (v, max = 1200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => !v ? "" : String(typeof v === "object" && v._id ? v._id : v);
function validDate(value) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }
function legacyDocumentStatus(value) { try { return normalizeDocumentStatus(value || "pending"); } catch { return "pending"; } }
async function migrateStudentDocs(models = {}) {
  const { StudentDoc, Student } = models;
  if (!StudentDoc || !Student) return { skipped: true, reason: "StudentDoc and Student models are required" };
  const [rows, students] = await Promise.all([StudentDoc.collection.find({}).toArray(), Student.collection.find({}).toArray()]);
  const byId = new Map(students.map((x) => [idText(x._id), x]));
  const byReg = new Map(students.map((x) => [str(x.regNo, 60).toLowerCase(), x]).filter(([k]) => k));
  let scanned = 0, normalized = 0, quarantined = 0, privateByDefault = 0;
  for (const row of rows) {
    scanned += 1;
    const reasons = [];
    const student = byId.get(idText(row.student || row.studentId)) || byReg.get(str(row.studentRegNo || row.regNo, 60).toLowerCase()) || null;
    if (!student || student.isDeleted === true) reasons.push("Student could not be resolved safely.");
    const rawDoc = row.doc || {};
    const url = safeStoredUrl(rawDoc.url || row.url);
    const publicId = str(rawDoc.publicId || row.publicId, 300);
    if (!url || !publicId) reasons.push("Stored document reference is incomplete or unsafe.");
    const type = normalizeStudentDocType(row.type || row.documentType, row.title || rawDoc.originalName || row.originalName);
    const issueDate = validDate(row.issueDate || row.issuedAt);
    const expiryDate = validDate(row.expiryDate || row.expiresAt);
    if (issueDate && expiryDate && expiryDate < issueDate) reasons.push("Document expiry date is before issue date.");
    let status = legacyDocumentStatus(row.status || row.verificationStatus);
    if (expiryDate && expiryDate < new Date()) status = "expired";
    const hadStudentVisibility = typeof row.studentVisible === "boolean";
    const hadParentVisibility = typeof row.parentVisible === "boolean";
    const studentVisible = hadStudentVisibility ? row.studentVisible : false;
    const parentVisible = hadParentVisibility ? row.parentVisible : false;
    if (!hadStudentVisibility && !hadParentVisibility) privateByDefault += 1;
    const quarantineAt = reasons.length ? (row.migrationQuarantinedAt || new Date()) : null;
    if (reasons.length) quarantined += 1;
    const set = {
      student: student?._id || row.student || null,
      type,
      title: str(row.title || rawDoc.originalName || row.originalName || "Student Document", 180),
      doc: {
        url: url || "https://invalid.local/quarantined",
        publicId: publicId || `quarantined-${idText(row._id)}`,
        resourceType: str(rawDoc.resourceType || row.resourceType || "auto", 20) || "auto",
        originalName: str(rawDoc.originalName || row.originalName, 200),
        bytes: Math.max(0, Number(rawDoc.bytes || row.bytes || 0)),
        mimeType: str(rawDoc.mimeType || row.mimeType, 100),
        source: str(rawDoc.source || row.source || (row.sourceApplicant ? "applicant_sync" : "legacy"), 40),
        sharedAsset: rawDoc.sharedAsset === true || row.sharedAsset === true || !!row.sourceApplicant,
        uploadedAt: validDate(rawDoc.uploadedAt || row.uploadedAt || row.createdAt) || new Date(),
      },
      status,
      issueDate,
      expiryDate,
      verifiedAt: status === "verified" ? (validDate(row.verifiedAt) || row.updatedAt || row.createdAt || new Date()) : null,
      verifiedBy: status === "verified" ? (row.verifiedBy || null) : null,
      rejectionReason: status === "rejected" ? str(row.rejectionReason || row.reason, 500) : "",
      studentVisible,
      parentVisible,
      revision: Math.max(0, Number(row.revision || 0)),
      isDeleted: row.isDeleted === true,
      migrationQuarantinedAt: quarantineAt,
      migrationQuarantineReason: reasons.join(" ").slice(0, 500),
    };
    await StudentDoc.collection.updateOne({ _id: row._id }, { $set: set });
    normalized += 1;
  }
  return { scanned, normalized, quarantined, privateByDefault };
}
module.exports = { legacyDocumentStatus, migrateStudentDocs };
