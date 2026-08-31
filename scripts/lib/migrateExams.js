const ACTIVE_STATUSES = new Set(["draft", "scheduled", "completed"]);
const EXAM_TYPES = new Set(["test", "quiz", "midterm", "endterm", "mock", "practical", "oral", "assignment"]);
const EXAM_INDEX_KEY = Object.freeze({
  classGroup: 1,
  sectionId: 1,
  streamId: 1,
  subject: 1,
  academicYear: 1,
  term: 1,
  examType: 1,
  examDate: 1,
});
const EXAM_INDEX_NAME = "uniq_active_exam_scope_schedule";

const str = (v, max = 180) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => {
  if (!v) return "";
  if (typeof v === "object" && v._id) return String(v._id);
  return String(v);
};
const isObjectIdText = (v) => /^[a-f\d]{24}$/i.test(idText(v));

function slugCode(value, fallback = "EXAM") {
  const out = str(value, 80).toUpperCase().replace(/&/g, "AND").replace(/[^A-Z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  return out || fallback;
}

function normalizeExamType(value) {
  const raw = str(value, 40).toLowerCase().replace(/[\s_-]+/g, "");
  const map = {
    test: "test", classtest: "test", exam: "test",
    quiz: "quiz",
    midterm: "midterm", midtermexam: "midterm",
    endterm: "endterm", endofterm: "endterm", final: "endterm", finalexam: "endterm",
    mock: "mock", mockexam: "mock",
    practical: "practical", practicalexam: "practical",
    oral: "oral", oralexam: "oral",
    assignment: "assignment",
  };
  return EXAM_TYPES.has(raw) ? raw : (map[raw] || "test");
}

function normalizeStatus(value) {
  const raw = str(value, 30).toLowerCase().replace(/[\s_-]+/g, "");
  if (["scheduled", "published", "active", "open"].includes(raw)) return "scheduled";
  if (["completed", "complete", "done", "finished", "closed"].includes(raw)) return "completed";
  if (["archived", "archive", "cancelled", "canceled", "deleted", "inactive"].includes(raw)) return "archived";
  return "draft";
}

function normalizeTerm(value, fallback = 1) {
  const n = Number(value || fallback || 1);
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), 3)) : 1;
}

function normalizeMarks(maxMarks, passMark) {
  const max = Number(maxMarks);
  const pass = Number(passMark);
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.min(max, 1000)) : 100;
  const safePass = Number.isFinite(pass) ? Math.max(0, Math.min(pass, safeMax)) : Math.min(50, safeMax);
  return { maxMarks: safeMax, passMark: safePass };
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = value instanceof Date ? "" : String(value).trim();
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) {
    const exact = new Date(Date.UTC(Number(direct[1]), Number(direct[2]) - 1, Number(direct[3])));
    return Number.isNaN(exact.getTime()) ? null : exact;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function normalizeClock(value) {
  const raw = str(value, 40);
  const match = raw.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/);
  if (!match) return "";
  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function parseLegacyTimeRange(row = {}) {
  let startTime = normalizeClock(row.startTime || row.start || row.timeStart);
  let endTime = normalizeClock(row.endTime || row.end || row.timeEnd);
  const raw = str(row.time || row.examTime || row.scheduleTime, 100);
  if (raw && (!startTime || !endTime)) {
    const clocks = [...raw.matchAll(/([01]?\d|2[0-3]):([0-5]\d)/g)].map((m) => `${String(m[1]).padStart(2, "0")}:${m[2]}`);
    if (!startTime && clocks[0]) startTime = clocks[0];
    if (!endTime && clocks[1]) endTime = clocks[1];
  }
  return { startTime, endTime };
}

function clockMinutes(value) {
  const m = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function buildLookup(rows = [], fields = ["code", "name", "title"]) {
  const byId = new Map();
  const byText = new Map();
  for (const row of rows) {
    byId.set(idText(row._id), row);
    for (const field of fields) {
      const key = str(row[field], 180).toLowerCase();
      if (key && !byText.has(key)) byText.set(key, row);
    }
  }
  return { byId, byText };
}

function resolveRecord(value, lookup) {
  const id = idText(value);
  if (id && lookup.byId.has(id)) return lookup.byId.get(id);
  const key = str(value, 180).toLowerCase();
  return key ? lookup.byText.get(key) || null : null;
}

function keysEqual(a = {}, b = {}) {
  return JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
}

async function dropConflictingExamIndexes(Exam) {
  if (!Exam?.collection?.indexes || !Exam?.collection?.dropIndex) return 0;
  let indexes = [];
  try { indexes = await Exam.collection.indexes(); } catch { return 0; }
  let dropped = 0;
  for (const idx of indexes) {
    if (idx.name === "_id_") continue;
    const sameKey = keysEqual(idx.key, EXAM_INDEX_KEY);
    if (!sameKey && idx.name !== EXAM_INDEX_NAME) continue;
    const desired = idx.name === EXAM_INDEX_NAME && idx.unique === true && idx.partialFilterExpression && Object.prototype.hasOwnProperty.call(idx.partialFilterExpression, "archivedAt");
    if (desired) continue;
    await Exam.collection.dropIndex(idx.name);
    dropped += 1;
  }
  return dropped;
}

async function ensureExamIndex(Exam) {
  if (!Exam?.collection?.createIndex) return false;
  await Exam.collection.createIndex(EXAM_INDEX_KEY, {
    unique: true,
    name: EXAM_INDEX_NAME,
    partialFilterExpression: { archivedAt: null },
  });
  return true;
}

function duplicateKey(row = {}) {
  if (!ACTIVE_STATUSES.has(row.status)) return "";
  return [
    idText(row.classGroup), idText(row.sectionId), idText(row.streamId), idText(row.subject),
    str(row.academicYear, 20), Number(row.term || 1), str(row.examType, 20),
    row.examDate instanceof Date ? row.examDate.toISOString() : String(row.examDate || ""),
  ].join("|");
}

async function migrateExams(models = {}) {
  const { Exam, Class, Section, Stream, Subject, Result } = models;
  if (!Exam || !Class || !Subject) return { skipped: true, reason: "Exam, Class and Subject models are required" };

  const droppedIndexes = await dropConflictingExamIndexes(Exam);
  const [rawExams, classes, sections, streams, subjects] = await Promise.all([
    Exam.collection.find({}).toArray(),
    Class.collection.find({}).toArray(),
    Section?.collection?.find ? Section.collection.find({}).toArray() : [],
    Stream?.collection?.find ? Stream.collection.find({}).toArray() : [],
    Subject.collection.find({}).toArray(),
  ]);

  const classLookup = buildLookup(classes, ["code", "name", "classLevel"]);
  const sectionLookup = buildLookup(sections, ["code", "name"]);
  const streamLookup = buildLookup(streams, ["code", "name"]);
  const subjectLookup = buildLookup(subjects, ["code", "title", "shortTitle", "name"]);

  let normalized = 0;
  let archivedUnresolved = 0;
  const normalizedRows = [];

  for (const row of rawExams) {
    const classRecord = resolveRecord(row.classGroup || row.classId || row.class || row.programId || row.className, classLookup);
    const subjectRecord = resolveRecord(row.subject || row.subjectId || row.courseId || row.courseCode || row.subjectCode || row.courseTitle || row.subjectTitle, subjectLookup);
    const sectionRecord = resolveRecord(row.sectionId || row.section || row.sectionCode || row.sectionName, sectionLookup);
    const streamRecord = resolveRecord(row.streamId || row.stream || row.streamCode || row.streamName, streamLookup);
    const examDate = normalizeDate(row.examDate || row.date || row.scheduledAt || row.startDate);
    const subjectMatchesClass = !!(classRecord && subjectRecord && idText(subjectRecord.classId) === idText(classRecord._id));
    const validSection = !sectionRecord || !classRecord || !sectionRecord.classId || idText(sectionRecord.classId) === idText(classRecord._id);
    const validStream = !streamRecord || !classRecord || !streamRecord.classId || idText(streamRecord.classId) === idText(classRecord._id);
    let status = normalizeStatus(row.status);
    const unresolved = !classRecord || !subjectRecord || !subjectMatchesClass || !examDate;
    if (unresolved) status = "archived";

    const academicYear = str(row.academicYear || row.year || classRecord?.academicYear, 20);
    const term = normalizeTerm(row.term || row.semester, classRecord?.term || 1);
    const examType = normalizeExamType(row.examType || row.type);
    const { startTime, endTime } = parseLegacyTimeRange(row);
    const startMinutes = clockMinutes(startTime);
    const endMinutes = clockMinutes(endTime);
    let durationMinutes = Number(row.durationMinutes || row.duration || 0);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) durationMinutes = 0;
    if (!durationMinutes && startMinutes !== null && endMinutes !== null && endMinutes > startMinutes) durationMinutes = endMinutes - startMinutes;
    const marks = normalizeMarks(row.maxMarks ?? row.totalMarks ?? row.marks, row.passMark ?? row.passingMarks);
    const fallbackCode = `EXAM-${idText(row._id).slice(-6).toUpperCase() || "LEGACY"}`;
    const code = slugCode(row.code || row.courseCode || `${examType}-${academicYear}-T${term}`, fallbackCode);
    const title = str(row.title || row.courseTitle || row.name || subjectRecord?.title || subjectRecord?.code || "Legacy Exam", 180) || "Legacy Exam";
    const now = row.updatedAt || row.createdAt || new Date();

    const set = {
      title,
      code,
      classGroup: classRecord?._id || null,
      sectionId: validSection ? (sectionRecord?._id || null) : null,
      sectionName: validSection ? (sectionRecord?.name || str(row.sectionName, 80)) : "",
      sectionCode: validSection ? (sectionRecord?.code || str(row.sectionCode, 40)) : "",
      streamId: validStream ? (streamRecord?._id || null) : null,
      streamName: validStream ? (streamRecord?.name || str(row.streamName || row.stream, 80)) : "",
      streamCode: validStream ? (streamRecord?.code || str(row.streamCode, 40)) : "",
      subject: subjectRecord?._id || null,
      academicYear,
      term,
      examType,
      examDate: examDate || row.createdAt || new Date(0),
      startTime,
      endTime,
      durationMinutes,
      maxMarks: marks.maxMarks,
      passMark: marks.passMark,
      room: str(row.room || row.venue || row.location, 80),
      campus: str(row.campus || row.campusName, 80),
      instructions: str(row.instructions || row.description || row.notes, 3000),
      status,
      publishedAt: ["scheduled", "completed"].includes(status) ? (row.publishedAt || now) : null,
      scheduleUpdatedAt: ["scheduled", "completed"].includes(status) ? (row.scheduleUpdatedAt || row.publishedAt || now) : null,
      completedAt: status === "completed" ? (row.completedAt || now) : null,
      archivedAt: status === "archived" ? (row.archivedAt || now) : null,
    };

    await Exam.collection.updateOne({ _id: row._id }, { $set: set });
    normalized += 1;
    if (unresolved) archivedUnresolved += 1;
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
  let duplicatesArchived = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    duplicateGroups += 1;
    const scored = [];
    for (const row of rows) {
      const resultCount = Result ? await Result.countDocuments({ exam: row._id }) : 0;
      scored.push({ row, resultCount });
    }
    scored.sort((a, b) => b.resultCount - a.resultCount || new Date(a.row.createdAt || 0) - new Date(b.row.createdAt || 0) || idText(a.row._id).localeCompare(idText(b.row._id)));
    for (const extra of scored.slice(1)) {
      const when = extra.row.updatedAt || extra.row.createdAt || new Date();
      await Exam.collection.updateOne({ _id: extra.row._id }, { $set: { status: "archived", archivedAt: when } });
      duplicatesArchived += 1;
    }
  }

  await ensureExamIndex(Exam);
  return { scanned: rawExams.length, normalized, archivedUnresolved, duplicateGroups, duplicatesArchived, droppedIndexes, indexEnsured: true };
}

module.exports = {
  ACTIVE_STATUSES,
  EXAM_INDEX_KEY,
  EXAM_INDEX_NAME,
  str,
  idText,
  isObjectIdText,
  slugCode,
  normalizeExamType,
  normalizeStatus,
  normalizeTerm,
  normalizeMarks,
  normalizeDate,
  normalizeClock,
  parseLegacyTimeRange,
  duplicateKey,
  migrateExams,
  dropConflictingExamIndexes,
  ensureExamIndex,
};
