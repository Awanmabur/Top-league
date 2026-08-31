const { hashSnapshot } = require("../../src/services/tenant/transcriptService");

const INDEX_NAME = "uniq_issued_transcript_number";
const INDEX_KEY = Object.freeze({ issueNumber: 1 });
const ISSUED_WORDS = new Set(["issued", "published", "released", "final", "approved"]);
const REVOKED_WORDS = new Set(["revoked", "cancelled", "canceled", "void", "invalidated"]);

const str = (v, max = 500) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => (v && typeof v === "object" && v._id ? String(v._id) : String(v || ""));

function normalizeTranscriptStatus(row = {}) {
  const raw = str(row.status, 40).toLowerCase().replace(/[\s_-]+/g, "");
  if (REVOKED_WORDS.has(raw) || row.revokedAt) return "revoked";
  if (ISSUED_WORDS.has(raw) || row.issuedAt || row.issueNumber) return "issued";
  return "draft";
}

function normalizeKind(value) {
  const raw = str(value, 30).toLowerCase();
  return raw === "unofficial" ? "unofficial" : "official";
}

function normalizeRangeMode(value) {
  const raw = str(value, 40).toLowerCase();
  return ["auto", "current_term", "all_available", "custom"].includes(raw) ? raw : "auto";
}

function normalizeTerm(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : fallback;
}

function keysEqual(a = {}, b = {}) {
  return JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
}

async function dropConflictingTranscriptIndexes(Transcript) {
  if (!Transcript?.collection?.indexes || !Transcript?.collection?.dropIndex) return 0;
  let indexes = [];
  try { indexes = await Transcript.collection.indexes(); } catch { return 0; }
  let dropped = 0;
  for (const idx of indexes) {
    if (idx.name === "_id_") continue;
    const sameKey = keysEqual(idx.key, INDEX_KEY);
    if (!sameKey && idx.name !== INDEX_NAME) continue;
    const partial = idx.partialFilterExpression || {};
    const desired = idx.name === INDEX_NAME && idx.unique === true && partial.issuedAt?.$type === "date" && Object.prototype.hasOwnProperty.call(partial, "migrationQuarantinedAt");
    if (desired) continue;
    await Transcript.collection.dropIndex(idx.name);
    dropped += 1;
  }
  return dropped;
}

async function ensureTranscriptIndex(Transcript) {
  if (!Transcript?.collection?.createIndex) return false;
  await Transcript.collection.createIndex(INDEX_KEY, {
    unique: true,
    name: INDEX_NAME,
    partialFilterExpression: { issuedAt: { $type: "date" }, migrationQuarantinedAt: null },
  });
  return true;
}

function issuedCompletenessScore(row = {}) {
  return [
    row.status === "issued" ? 2 : row.status === "revoked" ? 1 : 0,
    row.snapshot ? 1 : 0,
    row.snapshotHash ? 1 : 0,
    row.issuedAt ? 1 : 0,
    new Date(row.issuedAt || row.updatedAt || row.createdAt || 0).getTime() || 0,
  ];
}

function comparePreferred(a, b) {
  const aa = issuedCompletenessScore(a);
  const bb = issuedCompletenessScore(b);
  for (let i = 0; i < aa.length; i += 1) if (aa[i] !== bb[i]) return bb[i] - aa[i];
  return idText(a._id).localeCompare(idText(b._id));
}

async function migrateTranscripts(models = {}) {
  const { Transcript, Student } = models;
  if (!Transcript || !Student) return { skipped: true, reason: "Transcript and Student models are required" };

  const droppedIndexes = await dropConflictingTranscriptIndexes(Transcript);
  const [rows, students] = await Promise.all([
    Transcript.collection.find({}).toArray(),
    Student.collection.find({}).toArray(),
  ]);
  const studentById = new Map(students.map((s) => [idText(s._id), s]));
  const normalizedRows = [];
  let normalized = 0;
  let quarantined = 0;

  for (const row of rows) {
    const status = normalizeTranscriptStatus(row);
    const kind = normalizeKind(row.kind || row.type);
    const issueNumber = str(row.issueNumber || row.certificateNumber || row.referenceNumber, 80);
    const studentId = idText(row.student || row.studentId);
    const reasons = [];
    const student = studentById.get(studentId) || null;
    if (!student) reasons.push("Linked student could not be resolved.");
    if (["issued", "revoked"].includes(status)) {
      if (!issueNumber) reasons.push("Issued transcript has no issue number.");
      if (!row.issuedAt) reasons.push("Issued transcript has no issue timestamp.");
      if (!row.snapshot || typeof row.snapshot !== "object") reasons.push("Issued transcript has no immutable snapshot.");
    }

    const quarantinedAt = reasons.length ? (row.migrationQuarantinedAt || new Date()) : null;
    if (reasons.length) quarantined += 1;
    const snapshotHash = row.snapshot && typeof row.snapshot === "object" ? hashSnapshot(row.snapshot) : "";
    const set = {
      student: student?._id || row.student || null,
      status,
      kind,
      rangeMode: normalizeRangeMode(row.rangeMode),
      academicYearFrom: str(row.academicYearFrom || row.academicYear || row.yearFrom, 20),
      academicYearTo: str(row.academicYearTo || row.academicYear || row.yearTo, 20),
      termFrom: normalizeTerm(row.termFrom || row.term, 1),
      termTo: normalizeTerm(row.termTo || row.term, 3),
      includeDraftResults: ["issued", "revoked"].includes(status) ? false : (kind === "unofficial" && !!row.includeDraftResults),
      issueNumber: ["issued", "revoked"].includes(status) ? issueNumber : "",
      issuedAt: ["issued", "revoked"].includes(status) ? (row.issuedAt || null) : null,
      snapshotHash,
      verificationVersion: row.snapshot ? Number(row.verificationVersion || 1) : Number(row.verificationVersion || 1),
      migrationQuarantinedAt: quarantinedAt,
      migrationQuarantineReason: reasons.join(" ").slice(0, 500),
    };
    await Transcript.collection.updateOne({ _id: row._id }, { $set: set });
    normalizedRows.push({ ...row, ...set });
    normalized += 1;
  }

  const groups = new Map();
  for (const row of normalizedRows) {
    if (row.migrationQuarantinedAt || !row.issueNumber || !row.issuedAt) continue;
    const key = String(row.issueNumber).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let duplicateGroups = 0;
  let duplicatesQuarantined = 0;
  for (const matches of groups.values()) {
    if (matches.length < 2) continue;
    duplicateGroups += 1;
    matches.sort(comparePreferred);
    for (const duplicate of matches.slice(1)) {
      const reason = `Duplicate issued transcript number ${duplicate.issueNumber}; retained ${matches[0]._id}.`;
      await Transcript.collection.updateOne({ _id: duplicate._id }, { $set: {
        migrationQuarantinedAt: duplicate.migrationQuarantinedAt || new Date(),
        migrationQuarantineReason: reason.slice(0, 500),
      } });
      duplicatesQuarantined += 1;
    }
  }

  const indexCreated = await ensureTranscriptIndex(Transcript);
  return { scanned: rows.length, normalized, quarantined, duplicateGroups, duplicatesQuarantined, droppedIndexes, indexCreated };
}

module.exports = {
  INDEX_NAME,
  INDEX_KEY,
  normalizeTranscriptStatus,
  normalizeKind,
  normalizeRangeMode,
  dropConflictingTranscriptIndexes,
  ensureTranscriptIndex,
  migrateTranscripts,
};
