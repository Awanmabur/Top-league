const crypto = require("crypto");
const { defaultGrading } = require("./resultService");

const TRANSCRIPT_STATUSES = new Set(["draft", "issued", "revoked"]);
const TRANSCRIPT_KINDS = new Set(["official", "unofficial"]);
const RANGE_MODES = new Set(["auto", "current_term", "all_available", "custom"]);

const str = (value, max = 300) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};
const sameId = (a, b) => idText(a) === idText(b);

function normalizeStatus(value, fallback = "draft") {
  const status = str(value, 20).toLowerCase();
  if (!status) return fallback;
  if (!TRANSCRIPT_STATUSES.has(status)) throw new Error("Invalid transcript status.");
  return status;
}

function normalizeKind(value, fallback = "official") {
  const kind = str(value, 20).toLowerCase();
  if (!kind) return fallback;
  if (!TRANSCRIPT_KINDS.has(kind)) throw new Error("Invalid transcript type.");
  return kind;
}

function normalizeRangeMode(value, fallback = "auto") {
  const mode = str(value, 30).toLowerCase();
  if (!mode) return fallback;
  if (!RANGE_MODES.has(mode)) throw new Error("Invalid transcript range mode.");
  return mode;
}

function normalizeTerm(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3) return fallback;
  return n;
}

function academicYearKey(value) {
  const text = str(value, 20);
  if (!text) return { numeric: null, text: "" };
  const match = text.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  return { numeric: match ? Number(match[1]) : null, text: text.toLowerCase() };
}

function compareAcademicYear(a, b) {
  const ak = academicYearKey(a);
  const bk = academicYearKey(b);
  if (ak.numeric !== null && bk.numeric !== null && ak.numeric !== bk.numeric) return ak.numeric - bk.numeric;
  return ak.text.localeCompare(bk.text);
}

function compareAcademicPoint(aYear, aTerm, bYear, bTerm) {
  const yearCmp = compareAcademicYear(aYear, bYear);
  if (yearCmp !== 0) return yearCmp;
  return normalizeTerm(aTerm, 1) - normalizeTerm(bTerm, 1);
}

function normalizeRange(input = {}) {
  const range = {
    academicYearFrom: str(input.academicYearFrom, 20),
    academicYearTo: str(input.academicYearTo, 20),
    termFrom: normalizeTerm(input.termFrom, 1),
    termTo: normalizeTerm(input.termTo, 3),
  };
  if (range.academicYearFrom && range.academicYearTo && compareAcademicPoint(
    range.academicYearFrom,
    range.termFrom,
    range.academicYearTo,
    range.termTo
  ) > 0) {
    throw new Error("Transcript start period cannot be after the end period.");
  }
  return range;
}

function resultWithinRange(result = {}, range = {}) {
  const ay = str(result.academicYear, 20);
  const term = normalizeTerm(result.term, 1);
  if (range.academicYearFrom && compareAcademicPoint(ay, term, range.academicYearFrom, range.termFrom) < 0) return false;
  if (range.academicYearTo && compareAcademicPoint(ay, term, range.academicYearTo, range.termTo) > 0) return false;
  return true;
}

function transcriptResultStatusFilter(transcript = {}, { issuing = false } = {}) {
  const kind = normalizeKind(transcript.kind || "official");
  if (issuing || kind === "official") return "published";
  return transcript.includeDraftResults ? { $in: ["draft", "published"] } : "published";
}

function assertTranscriptEditable(transcript = {}) {
  const status = normalizeStatus(transcript.status || "draft");
  if (status !== "draft") throw new Error("Issued or revoked transcripts are immutable. Clone the transcript to make changes.");
  if (transcript.migrationQuarantinedAt) throw new Error("Quarantined legacy transcripts cannot be edited.");
  return true;
}

function wasEverIssued(transcript = {}) {
  return !!(transcript.issueNumber || transcript.issuedAt || transcript.issuedBy || transcript.revokedAt || transcript.revokedBy);
}

function assertTranscriptDeleteAllowed(transcript = {}) {
  assertTranscriptEditable(transcript);
  if (wasEverIssued(transcript)) throw new Error("A transcript that has ever been issued must be retained for audit.");
  return true;
}

function assertTranscriptIssueAllowed(transcript = {}, live = null) {
  assertTranscriptEditable(transcript);
  if (transcript.includeDraftResults) throw new Error("Draft results cannot be included in an issued transcript.");
  if (!live || !Array.isArray(live.terms) || !live.terms.length) throw new Error("Cannot issue a transcript with no published results.");
  if (!Array.isArray(live.sourceResults) || !live.sourceResults.length) throw new Error("Cannot issue a transcript without result provenance.");
  if (live.sourceResults.some((row) => String(row.status || "").toLowerCase() !== "published")) {
    throw new Error("Issued transcripts may contain published results only.");
  }
  return true;
}

function assertTranscriptRevokeAllowed(transcript = {}, reason = "") {
  if (normalizeStatus(transcript.status || "draft") !== "issued") throw new Error("Only an issued transcript can be revoked.");
  const cleanReason = str(reason, 300);
  if (cleanReason.length < 5) throw new Error("A revoke reason of at least 5 characters is required.");
  return cleanReason;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function hashSnapshot(snapshot) {
  return crypto.createHash("sha256").update(stableStringify(snapshot || {})).digest("hex");
}

function snapshotIntegrityOk(transcript = {}) {
  if (!transcript.snapshot || !transcript.snapshotHash) return false;
  const expected = hashSnapshot(transcript.snapshot);
  const actual = String(transcript.snapshotHash || "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqualText(expected, actual);
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length || !left.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signingSecret() {
  return String(process.env.TRANSCRIPT_SIGNING_SECRET || "");
}

function assertSigningConfigured() {
  const secret = signingSecret();
  if (Buffer.byteLength(secret) < 32) throw new Error("TRANSCRIPT_SIGNING_SECRET must be configured with at least 32 bytes before issuing transcripts.");
  return secret;
}

function verificationPayload(transcript = {}) {
  const issueNumber = str(transcript.issueNumber, 80);
  const issuedAtISO = transcript.issuedAt ? new Date(transcript.issuedAt).toISOString() : "";
  return `${issueNumber}|${issuedAtISO}|${String(transcript.snapshotHash || "").toLowerCase()}`;
}

function legacyVerificationPayload(transcript = {}) {
  const issueNumber = str(transcript.issueNumber, 80);
  const issuedAtISO = transcript.issuedAt ? new Date(transcript.issuedAt).toISOString() : "";
  return `${issueNumber}|${issuedAtISO}`;
}

function signPayload(payload, secret = signingSecret()) {
  if (Buffer.byteLength(String(secret || "")) < 32) return "";
  return crypto.createHmac("sha256", secret).update(String(payload || "")).digest("hex");
}

function verificationSignature(transcript = {}, secret = signingSecret()) {
  return signPayload(verificationPayload(transcript), secret);
}

function verifyTranscriptCredential(transcript = {}, signature = "", secret = signingSecret()) {
  if (!transcript || transcript.migrationQuarantinedAt) return { ok: false, reason: "Transcript is not verifiable." };
  if (!transcript.issueNumber || !transcript.issuedAt || !transcript.snapshot) return { ok: false, reason: "Transcript credential is incomplete." };
  if (Buffer.byteLength(String(secret || "")) < 32) return { ok: false, reason: "Verification secret not configured on server.", serverError: true };
  if (!snapshotIntegrityOk(transcript)) return { ok: false, reason: "Transcript snapshot integrity check failed." };

  const sig = str(signature, 256).toLowerCase();
  const expected = verificationSignature(transcript, secret);
  let signatureOk = timingSafeEqualText(sig, expected);
  if (!signatureOk && Number(transcript.verificationVersion || 1) < 2) {
    signatureOk = timingSafeEqualText(sig, signPayload(legacyVerificationPayload(transcript), secret));
  }
  if (!signatureOk) return { ok: false, reason: "Invalid verification signature." };
  if (normalizeStatus(transcript.status || "draft") === "revoked") return { ok: false, reason: "This transcript has been revoked.", revoked: true };
  if (normalizeStatus(transcript.status || "draft") !== "issued") return { ok: false, reason: "This transcript is not issued." };
  return { ok: true };
}

function newIssueNumber(now = new Date(), randomBytes = crypto.randomBytes) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const entropy = randomBytes(6).toString("hex").toUpperCase();
  return `CA-TR-${y}${m}${d}-${entropy}`;
}

function transcriptDisplaySnapshot(transcript = {}) {
  if (!transcript.snapshot) return null;
  const snapshot = JSON.parse(JSON.stringify(transcript.snapshot));
  snapshot.transcriptMeta = {
    ...(snapshot.transcriptMeta || {}),
    _id: transcript._id || snapshot.transcriptMeta?._id || null,
    kind: transcript.kind || snapshot.transcriptMeta?.kind || "official",
    status: transcript.status || snapshot.transcriptMeta?.status || "draft",
    issueNumber: transcript.issueNumber || snapshot.transcriptMeta?.issueNumber || "",
    issuedAt: transcript.issuedAt || snapshot.transcriptMeta?.issuedAt || null,
    revokedAt: transcript.revokedAt || null,
    revokeReason: transcript.revokeReason || "",
  };
  return snapshot;
}

function summarizePublishedResults(results = []) {
  const rows = results.map((r) => {
    const totalMarks = Number(r.totalMarks || r.exam?.maxMarks || 100);
    const score = Number(r.score || 0);
    const percentage = Number.isFinite(Number(r.percentage))
      ? Number(r.percentage)
      : totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;
    const passRaw = Number.isFinite(Number(r.passMark)) ? Number(r.passMark) : Number(r.exam?.passMark || 50);
    const passPercentage = totalMarks > 0 ? Math.round((passRaw / totalMarks) * 10000) / 100 : 50;
    const auto = defaultGrading(percentage);
    return {
      id: idText(r._id),
      academicYear: str(r.academicYear, 20),
      term: normalizeTerm(r.term, 1),
      subjectCode: str(r.subject?.code || r.subjectCode, 80),
      subjectTitle: str(r.subject?.title || r.subject?.shortTitle || "Subject", 180),
      examTitle: str(r.exam?.title || "Exam", 180),
      rawScore: score,
      totalMarks,
      percentage,
      passPercentage,
      grade: str(r.grade, 20) || auto.grade,
      remark: str(r.remark, 300) || auto.remark,
      publishedAt: r.publishedAt || null,
      passed: percentage >= passPercentage,
    };
  });
  const average = rows.length ? Math.round((rows.reduce((sum, r) => sum + r.percentage, 0) / rows.length) * 100) / 100 : 0;
  const latest = rows[0] || null;
  const latestRows = latest ? rows.filter((r) => r.academicYear === latest.academicYear && r.term === latest.term) : [];
  const latestAverage = latestRows.length ? Math.round((latestRows.reduce((sum, r) => sum + r.percentage, 0) / latestRows.length) * 100) / 100 : 0;
  const overall = defaultGrading(average);
  return {
    rows,
    average,
    latestAverage,
    passed: rows.filter((r) => r.passed).length,
    failed: rows.filter((r) => !r.passed).length,
    latestAcademicYear: latest?.academicYear || "",
    latestTerm: latest?.term || null,
    overallGrade: rows.length ? overall.grade : "—",
    overallRemark: rows.length ? overall.remark : "No published results",
  };
}

module.exports = {
  TRANSCRIPT_STATUSES,
  TRANSCRIPT_KINDS,
  RANGE_MODES,
  str,
  idText,
  sameId,
  normalizeStatus,
  normalizeKind,
  normalizeRangeMode,
  normalizeTerm,
  compareAcademicYear,
  compareAcademicPoint,
  normalizeRange,
  resultWithinRange,
  transcriptResultStatusFilter,
  assertTranscriptEditable,
  wasEverIssued,
  assertTranscriptDeleteAllowed,
  assertTranscriptIssueAllowed,
  assertTranscriptRevokeAllowed,
  stableStringify,
  hashSnapshot,
  snapshotIntegrityOk,
  timingSafeEqualText,
  assertSigningConfigured,
  verificationPayload,
  legacyVerificationPayload,
  signPayload,
  verificationSignature,
  verifyTranscriptCredential,
  newIssueNumber,
  transcriptDisplaySnapshot,
  summarizePublishedResults,
};
