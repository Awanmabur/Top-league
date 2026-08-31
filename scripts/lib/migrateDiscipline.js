const { newCaseNumber, normalizeCaseStatus } = require("../../src/services/tenant/disciplineService");
const str = (v, max = 1500) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => !v ? "" : String(typeof v === "object" && v._id ? v._id : v);
function legacyDisciplineStatus(value) {
  const raw = str(value, 40).toLowerCase();
  const map = { pending: "open", active: "open", review: "investigating", investigation: "investigating", closed: "resolved", complete: "resolved", cancelled: "dismissed", canceled: "dismissed" };
  try { return normalizeCaseStatus(map[raw] || raw || "open"); } catch { return null; }
}
function validDate(value) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }
async function migrateDiscipline(models = {}) {
  const { DisciplineCase, Student } = models;
  if (!DisciplineCase || !Student) return { skipped: true, reason: "DisciplineCase and Student models are required" };
  const [rows, students] = await Promise.all([DisciplineCase.collection.find({}).toArray(), Student.collection.find({}).toArray()]);
  const byId = new Map(students.map((x) => [idText(x._id), x]));
  const byReg = new Map(students.map((x) => [str(x.regNo, 60).toLowerCase(), x]).filter(([k]) => k));
  const used = new Set();
  let scanned = 0, normalized = 0, quarantined = 0, caseNumbersReplaced = 0;
  for (const row of rows) {
    scanned += 1;
    const reasons = [];
    const student = byId.get(idText(row.student || row.studentId)) || byReg.get(str(row.studentRegNo || row.regNo, 60).toLowerCase()) || null;
    if (!student || student.isDeleted === true) reasons.push("Student could not be resolved safely.");
    let status = legacyDisciplineStatus(row.status || row.state);
    if (!status) { status = "open"; reasons.push("Discipline status is invalid."); }
    const incidentDate = validDate(row.incidentDate || row.date || row.createdAt);
    if (!incidentDate) reasons.push("Incident date is invalid.");
    let caseNo = str(row.caseNo || row.caseNumber, 40);
    if (!caseNo || used.has(caseNo.toUpperCase())) {
      do { caseNo = newCaseNumber(incidentDate || new Date()); } while (used.has(caseNo.toUpperCase()));
      caseNumbersReplaced += 1;
    }
    used.add(caseNo.toUpperCase());
    const studentVisible = typeof row.studentVisible === "boolean" ? row.studentVisible : false;
    const parentVisible = typeof row.parentVisible === "boolean" ? row.parentVisible : false;
    const quarantineAt = reasons.length ? (row.migrationQuarantinedAt || new Date()) : null;
    if (reasons.length) quarantined += 1;
    const closed = ["resolved", "dismissed"].includes(status);
    const set = {
      caseNo,
      student: student?._id || row.student || null,
      studentRegNo: str(row.studentRegNo || student?.regNo, 60),
      studentName: str(row.studentName || student?.fullName || [student?.firstName, student?.lastName].filter(Boolean).join(" "), 120),
      classId: str(row.classId || student?.classId, 80),
      className: str(row.className || student?.className, 180),
      academicYear: str(row.academicYear || student?.academicYear, 20),
      term: [1, 2, 3].includes(Number(row.term || student?.term)) ? Number(row.term || student?.term) : null,
      incidentDate: incidentDate || new Date(0),
      category: str(row.category || row.type || "General", 80) || "General",
      description: str(row.description || row.details || row.note || "Legacy discipline record", 1500),
      status,
      studentVisible,
      parentVisible,
      publishedAt: row.publishedAt || ((studentVisible || parentVisible) ? (row.updatedAt || row.createdAt || new Date()) : null),
      resolutionSummary: str(row.resolutionSummary || (closed ? row.resolution || row.outcome || row.note : ""), 1200),
      actions: (Array.isArray(row.actions) ? row.actions : []).map((a) => ({ action: str(a?.action || a?.type, 120), details: str(a?.details || a?.note, 800), date: validDate(a?.date || a?.createdAt) || incidentDate || new Date(0), by: a?.by || a?.createdBy || null, visibleToStudent: a?.visibleToStudent === true, visibleToParent: a?.visibleToParent === true })),
      resolvedAt: row.resolvedAt || (closed ? (row.updatedAt || row.createdAt || new Date()) : null),
      revision: Math.max(0, Number(row.revision || 0)),
      isDeleted: row.isDeleted === true,
      migrationQuarantinedAt: quarantineAt,
      migrationQuarantineReason: reasons.join(" ").slice(0, 500),
    };
    await DisciplineCase.collection.updateOne({ _id: row._id }, { $set: set });
    normalized += 1;
  }
  return { scanned, normalized, quarantined, caseNumbersReplaced };
}
module.exports = { legacyDisciplineStatus, migrateDiscipline };
