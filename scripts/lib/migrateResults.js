const RESULT_INDEX_KEY = Object.freeze({ exam: 1, student: 1 });
const RESULT_INDEX_NAME = "uniq_active_result_exam_student";
const PUBLISHED_WORDS = new Set(["published", "released", "final", "approved", "issued", "visible"]);

const str = (v, max = 300) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => {
  if (!v) return "";
  if (typeof v === "object" && v._id) return String(v._id);
  return String(v);
};

function buildUniqueLookup(rows = [], fields = []) {
  const byId = new Map();
  const buckets = new Map();
  for (const row of rows) {
    byId.set(idText(row._id), row);
    for (const field of fields) {
      const key = str(row[field], 180).toLowerCase();
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
  }
  const byText = new Map();
  for (const [key, matches] of buckets.entries()) if (matches.length === 1) byText.set(key, matches[0]);
  return { byId, byText };
}

function resolveRecord(value, lookup) {
  const id = idText(value);
  if (id && lookup.byId.has(id)) return lookup.byId.get(id);
  const key = str(value, 180).toLowerCase();
  return key ? lookup.byText.get(key) || null : null;
}

function normalizeStatus(row = {}) {
  const raw = str(row.status, 40).toLowerCase().replace(/[\s_-]+/g, "");
  if (PUBLISHED_WORDS.has(raw) || row.publishedAt || row.releasedAt || row.issuedAt) return "published";
  return "draft";
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractLegacyScore(row = {}, exam = {}) {
  const totalMarks = finiteNumber(exam.maxMarks) ?? finiteNumber(row.maxMarks) ?? 100;
  if (!(totalMarks > 0)) return { ok: false, reason: "Exam total marks are invalid." };

  let score = finiteNumber(row.score);
  if (score === null) score = finiteNumber(row.totalScore);
  if (score === null) score = finiteNumber(row.marks);
  if (score === null) score = finiteNumber(row.mark);
  if (score === null) score = finiteNumber(row.examMarks);
  if (score === null) score = finiteNumber(row.finalExam);
  if (score === null) {
    const percentage = finiteNumber(row.percentage);
    if (percentage !== null) score = (percentage / 100) * totalMarks;
  }

  if (score === null) return { ok: false, reason: "No reliable score could be resolved." };
  if (score < 0 || score > totalMarks) return { ok: false, reason: `Resolved score ${score} is outside 0-${totalMarks}.` };
  const normalizedScore = Math.round(score * 100) / 100;
  const percentage = Math.round((normalizedScore / totalMarks) * 10000) / 100;
  return { ok: true, totalMarks, score: normalizedScore, percentage };
}

function defaultGrading(percentage) {
  const p = Math.max(0, Math.min(Number(percentage || 0), 100));
  if (p >= 80) return { grade: "A", remark: "Excellent" };
  if (p >= 75) return { grade: "A-", remark: "Very Good" };
  if (p >= 70) return { grade: "B+", remark: "Very Good" };
  if (p >= 65) return { grade: "B", remark: "Good" };
  if (p >= 60) return { grade: "B-", remark: "Good" };
  if (p >= 55) return { grade: "C+", remark: "Satisfactory" };
  if (p >= 50) return { grade: "C", remark: "Satisfactory" };
  if (p >= 45) return { grade: "C-", remark: "Pass" };
  if (p >= 40) return { grade: "D", remark: "Pass" };
  return { grade: "F", remark: "Fail" };
}

function keysEqual(a = {}, b = {}) {
  return JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
}

async function dropConflictingResultIndexes(Result) {
  if (!Result?.collection?.indexes || !Result?.collection?.dropIndex) return 0;
  let indexes = [];
  try { indexes = await Result.collection.indexes(); } catch { return 0; }
  let dropped = 0;
  for (const idx of indexes) {
    if (idx.name === "_id_") continue;
    const sameKey = keysEqual(idx.key, RESULT_INDEX_KEY);
    if (!sameKey && idx.name !== RESULT_INDEX_NAME) continue;
    const desired = idx.name === RESULT_INDEX_NAME && idx.unique === true && idx.partialFilterExpression && Object.prototype.hasOwnProperty.call(idx.partialFilterExpression, "migrationQuarantinedAt");
    if (desired) continue;
    await Result.collection.dropIndex(idx.name);
    dropped += 1;
  }
  return dropped;
}

async function ensureResultIndex(Result) {
  if (!Result?.collection?.createIndex) return false;
  await Result.collection.createIndex(RESULT_INDEX_KEY, {
    unique: true,
    name: RESULT_INDEX_NAME,
    partialFilterExpression: { migrationQuarantinedAt: null },
  });
  return true;
}

function duplicateKey(row = {}) {
  if (row.migrationQuarantinedAt) return "";
  const exam = idText(row.exam);
  const student = idText(row.student);
  return exam && student ? `${exam}|${student}` : "";
}

function duplicateScore(row = {}) {
  return [
    normalizeStatus(row) === "published" ? 1 : 0,
    row.firstPublishedAt || row.publishedAt ? 1 : 0,
    finiteNumber(row.score) !== null ? 1 : 0,
    new Date(row.updatedAt || row.createdAt || 0).getTime() || 0,
  ];
}

function comparePreferred(a, b) {
  const aa = duplicateScore(a);
  const bb = duplicateScore(b);
  for (let i = 0; i < aa.length; i += 1) if (aa[i] !== bb[i]) return bb[i] - aa[i];
  return idText(a._id).localeCompare(idText(b._id));
}

async function migrateResults(models = {}) {
  const { Result, Exam, Student } = models;
  if (!Result || !Exam || !Student) return { skipped: true, reason: "Result, Exam and Student models are required" };

  const droppedIndexes = await dropConflictingResultIndexes(Result);
  const [rawResults, exams, students] = await Promise.all([
    Result.collection.find({}).toArray(),
    Exam.collection.find({}).toArray(),
    Student.collection.find({}).toArray(),
  ]);

  const examLookup = buildUniqueLookup(exams, ["code", "title", "name"]);
  const studentLookup = buildUniqueLookup(students, ["regNo", "studentNo", "studentNumber", "indexNumber", "fullName", "name"]);
  const normalizedRows = [];
  let normalized = 0;
  let quarantined = 0;

  for (const row of rawResults) {
    const exam = resolveRecord(row.exam || row.examId || row.assessmentId || row.examTitle || row.assessment, examLookup);
    const student = resolveRecord(row.student || row.studentId || row.regNo || row.studentNo || row.studentNumber || row.indexNumber || row.studentName, studentLookup);
    const scoreInfo = exam ? extractLegacyScore(row, exam) : { ok: false, reason: "Linked exam could not be resolved." };
    const reasons = [];
    if (!exam) reasons.push("Linked exam could not be resolved.");
    if (!student) reasons.push("Linked student could not be resolved.");
    if (!scoreInfo.ok) reasons.push(scoreInfo.reason);

    const status = normalizeStatus(row);
    const now = row.updatedAt || row.createdAt || new Date();
    const auto = scoreInfo.ok ? defaultGrading(scoreInfo.percentage) : { grade: "", remark: "" };
    const passMark = exam ? Math.max(0, Math.min(finiteNumber(exam.passMark) ?? 50, finiteNumber(exam.maxMarks) ?? scoreInfo.totalMarks ?? 100)) : 50;
    const set = {
      exam: exam?._id || null,
      student: student?._id || null,
      classGroup: exam?.classGroup || null,
      sectionId: exam?.sectionId || null,
      sectionName: str(exam?.sectionName || row.sectionName, 180),
      sectionCode: str(exam?.sectionCode || row.sectionCode, 80),
      streamId: exam?.streamId || null,
      streamName: str(exam?.streamName || row.streamName || row.stream, 180),
      streamCode: str(exam?.streamCode || row.streamCode, 80),
      subject: exam?.subject || null,
      academicYear: str(exam?.academicYear || row.academicYear || row.year, 20),
      term: Math.max(1, Math.min(Number(exam?.term || row.term || row.semester || 1), 3)),
      totalMarks: scoreInfo.ok ? scoreInfo.totalMarks : Math.max(1, finiteNumber(exam?.maxMarks) ?? 100),
      passMark,
      score: scoreInfo.ok ? scoreInfo.score : 0,
      percentage: scoreInfo.ok ? scoreInfo.percentage : 0,
      grade: str(row.grade || row.letterGrade || auto.grade, 10),
      remark: str(row.remark || row.remarks || row.comment || auto.remark, 300),
      status,
      enteredBy: row.enteredBy || row.createdBy || null,
      updatedBy: row.updatedBy || row.enteredBy || row.createdBy || null,
      firstPublishedAt: status === "published" ? (row.firstPublishedAt || row.publishedAt || row.releasedAt || row.issuedAt || now) : (row.firstPublishedAt || null),
      publishedAt: status === "published" ? (row.publishedAt || row.releasedAt || row.issuedAt || now) : null,
      publishedBy: status === "published" ? (row.publishedBy || row.enteredBy || row.createdBy || null) : (row.publishedBy || null),
      reopenedAt: row.reopenedAt || null,
      reopenedBy: row.reopenedBy || null,
      revision: Math.max(0, Number(row.revision || 0)),
      migrationQuarantinedAt: reasons.length ? (row.migrationQuarantinedAt || now) : null,
      migrationQuarantineReason: reasons.length ? str(reasons.join(" "), 500) : "",
    };

    await Result.collection.updateOne({ _id: row._id }, { $set: set });
    normalized += 1;
    if (reasons.length) quarantined += 1;
    normalizedRows.push({ ...row, ...set });
  }

  const groups = new Map();
  for (const row of normalizedRows) {
    const key = duplicateKey(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let duplicateGroups = 0;
  let duplicatesQuarantined = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    duplicateGroups += 1;
    rows.sort(comparePreferred);
    for (const extra of rows.slice(1)) {
      const when = extra.updatedAt || extra.createdAt || new Date();
      await Result.collection.updateOne(
        { _id: extra._id },
        { $set: { migrationQuarantinedAt: when, migrationQuarantineReason: "Duplicate exam/student result retained outside the active result set." } }
      );
      duplicatesQuarantined += 1;
    }
  }

  await ensureResultIndex(Result);
  return { scanned: rawResults.length, normalized, quarantined, duplicateGroups, duplicatesQuarantined, droppedIndexes, indexEnsured: true };
}

module.exports = {
  RESULT_INDEX_KEY,
  RESULT_INDEX_NAME,
  str,
  idText,
  buildUniqueLookup,
  resolveRecord,
  normalizeStatus,
  extractLegacyScore,
  defaultGrading,
  duplicateKey,
  comparePreferred,
  dropConflictingResultIndexes,
  ensureResultIndex,
  migrateResults,
};
