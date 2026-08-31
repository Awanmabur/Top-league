const crypto = require("crypto");

const APPLICANT_STATUSES = Object.freeze(["submitted", "under_review", "accepted", "rejected", "converted"]);
const REQUIRED_DOC_KEYS = Object.freeze(["idDocument", "passportPhoto", "transcript"]);
const DOC_KEYS = Object.freeze([...REQUIRED_DOC_KEYS, "otherDocs"]);
const INTERVIEW_MODES = Object.freeze(["in-person", "online", "phone"]);
const CHECKLIST_KEYS = Object.freeze(["identityVerified", "academicsReviewed", "documentsComplete", "feeCleared"]);
const REQUEST_CHANNELS = Object.freeze(["email", "sms", "both"]);
const CONVERSION_LEASE_MS = 5 * 60 * 1000;

function str(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanEmail(value) {
  return str(value, 160).toLowerCase();
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStatus(value, fallback = "submitted") {
  const candidate = str(value, 30).toLowerCase();
  return APPLICANT_STATUSES.includes(candidate) ? candidate : fallback;
}

function canTransitionApplicantStatus(fromValue, toValue, options = {}) {
  const from = normalizeStatus(fromValue);
  const to = normalizeStatus(toValue);
  if (from === to) return true;
  if (from === "converted") return false;
  if (to === "converted") return options.allowConversion === true && from === "accepted";

  const allowed = {
    submitted: new Set(["under_review", "accepted", "rejected"]),
    under_review: new Set(["accepted", "rejected", "submitted"]),
    accepted: new Set(["under_review", "rejected"]),
    rejected: new Set(["under_review", "submitted"]),
  };
  return Boolean(allowed[from]?.has(to));
}

function assertApplicantTransition(fromValue, toValue, options = {}) {
  const from = normalizeStatus(fromValue);
  const to = normalizeStatus(toValue);
  if (!canTransitionApplicantStatus(from, to, options)) {
    throw new Error(`Applicant status cannot move from ${from} to ${to}.`);
  }
  return to;
}

function hasStoredDoc(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some((item) => hasStoredDoc(item));
  if (typeof value === "string") return Boolean(value.trim());
  return Boolean(String(value.url || value.filePath || "").trim());
}

function isVerifiedDoc(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => isVerifiedDoc(item));
  return hasStoredDoc(value) && value.verified === true;
}

function documentCompleteness(applicant = {}) {
  const uploaded = REQUIRED_DOC_KEYS.filter((key) => hasStoredDoc(applicant[key])).length;
  const verified = REQUIRED_DOC_KEYS.filter((key) => isVerifiedDoc(applicant[key])).length;
  return {
    total: REQUIRED_DOC_KEYS.length,
    uploaded,
    verified,
    missingKeys: REQUIRED_DOC_KEYS.filter((key) => !hasStoredDoc(applicant[key])),
  };
}

function normalizeRequestedDocKeys(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(raw.map((x) => str(x, 50)).filter((x) => REQUIRED_DOC_KEYS.includes(x)))];
}

function normalizeInterviewMode(value) {
  const mode = str(value, 30).toLowerCase();
  return INTERVIEW_MODES.includes(mode) ? mode : "in-person";
}

function normalizeRequestChannel(value) {
  const channel = str(value, 20).toLowerCase();
  return REQUEST_CHANNELS.includes(channel) ? channel : "email";
}

function boolFromForm(value) {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "checked"].includes(text);
}

function normalizeChecklist(body = {}) {
  const result = {};
  for (const key of CHECKLIST_KEYS) result[key] = boolFromForm(body[key]);
  return result;
}

function sanitizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(raw.map((x) => str(x, 40).toLowerCase()).filter(Boolean))].slice(0, 20);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function applicationIdCandidate(now = new Date()) {
  const year = now.getUTCFullYear();
  let digits = "";
  for (let i = 0; i < 8; i += 1) digits += crypto.randomInt(0, 10);
  return `APP-${year}-${digits}`;
}

async function allocateApplicationId(Applicant, now = new Date(), attempts = 16) {
  if (!Applicant?.exists && !Applicant?.findOne) throw new Error("Applicant model is unavailable.");
  for (let i = 0; i < attempts; i += 1) {
    const value = applicationIdCandidate(now);
    const found = Applicant.exists
      ? await Applicant.exists({ applicationId: value, isDeleted: { $ne: true } })
      : await Applicant.findOne({ applicationId: value, isDeleted: { $ne: true } }).lean();
    if (!found) return value;
  }
  throw new Error("Unable to allocate a unique application ID.");
}

function offerLetterNoCandidate(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const suffix = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `OFF-${y}${m}${d}-${suffix}`;
}

async function allocateOfferLetterNo(OfferLetter, now = new Date(), attempts = 16) {
  if (!OfferLetter?.exists && !OfferLetter?.findOne) throw new Error("OfferLetter model is unavailable.");
  for (let i = 0; i < attempts; i += 1) {
    const value = offerLetterNoCandidate(now);
    const found = OfferLetter.exists
      ? await OfferLetter.exists({ letterNo: value, isDeleted: { $ne: true } })
      : await OfferLetter.findOne({ letterNo: value, isDeleted: { $ne: true } }).lean();
    if (!found) return value;
  }
  throw new Error("Unable to allocate a unique offer letter number.");
}


function conversionToken() {
  return crypto.randomBytes(16).toString("hex");
}

async function claimApplicantConversion(Applicant, input = {}) {
  if (!Applicant?.findOneAndUpdate) throw new Error("Applicant model is unavailable.");
  const id = input.id;
  const currentStatus = normalizeStatus(input.currentStatus);
  const acceptedStatus = assertApplicantTransition(currentStatus, "accepted");
  assertApplicantTransition(acceptedStatus, "converted", { allowConversion: true });

  const now = input.now instanceof Date ? input.now : new Date();
  const staleBefore = new Date(now.getTime() - CONVERSION_LEASE_MS);
  const token = conversionToken();
  const patch = {
    status: "accepted",
    decidedAt: now,
    decidedBy: input.actorUserId || null,
    conversionLockToken: token,
    conversionLockAt: now,
    conversionLockBy: input.actorUserId || null,
  };
  const note = str(input.decisionNote, 400);
  if (note) patch.decisionNote = note;

  const applicant = await Applicant.findOneAndUpdate(
    {
      _id: id,
      isDeleted: { $ne: true },
      status: currentStatus,
      convertedStudentId: null,
      $or: [
        { conversionLockAt: null },
        { conversionLockAt: { $exists: false } },
        { conversionLockAt: { $lt: staleBefore } },
      ],
    },
    { $set: patch },
    { new: true },
  );
  if (!applicant) throw new Error("Applicant is already being admitted or changed while you were reviewing it. Reload and try again.");
  return { applicant, token };
}

async function finalizeApplicantConversion(Applicant, input = {}) {
  if (!Applicant?.updateOne) throw new Error("Applicant model is unavailable.");
  const result = await Applicant.updateOne(
    {
      _id: input.id,
      isDeleted: { $ne: true },
      status: "accepted",
      conversionLockToken: input.token,
      convertedStudentId: null,
    },
    {
      $set: {
        status: "converted",
        convertedStudentId: input.studentId,
        linkedStudent: input.studentId,
        regNo: str(input.regNo, 60),
        section1: input.sectionId || null,
        program1: input.sectionId || null,
        conversionLockToken: "",
        conversionLockAt: null,
        conversionLockBy: null,
      },
    },
  );
  if (!result?.modifiedCount) throw new Error("Applicant conversion could not be finalized safely.");
  return result;
}

async function releaseApplicantConversion(Applicant, id, token) {
  if (!Applicant?.updateOne || !id || !token) return;
  await Applicant.updateOne(
    { _id: id, conversionLockToken: token, status: "accepted", convertedStudentId: null },
    { $set: { conversionLockToken: "", conversionLockAt: null, conversionLockBy: null } },
  ).catch(() => null);
}

function applicantDisplayName(applicant = {}) {
  return str(
    applicant.fullName || [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(" "),
    160,
  ) || "Applicant";
}

function documentLabel(key) {
  return {
    idDocument: "National ID / Passport",
    passportPhoto: "Passport Photo",
    transcript: "Transcript / Results Slip",
  }[key] || key;
}

function requestDocsEmail({ applicant, keys = [], deadline, message, tenantName }) {
  const name = applicantDisplayName(applicant);
  const list = normalizeRequestedDocKeys(keys).map(documentLabel);
  const deadlineText = deadline instanceof Date && !Number.isNaN(deadline.getTime())
    ? deadline.toLocaleDateString("en-GB")
    : "as soon as possible";
  const custom = str(message, 1200);
  const subject = `Admission application documents • ${str(applicant?.applicationId, 80) || tenantName || "Admissions"}`;
  const html = [
    `<p>Hello ${escapeHtml(name)},</p>`,
    custom ? `<p>${escapeHtml(custom)}</p>` : "<p>Please provide the missing documents for your admission application.</p>",
    list.length ? `<p><strong>Missing documents:</strong></p><ul>${list.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "",
    `<p><strong>Deadline:</strong> ${escapeHtml(deadlineText)}</p>`,
    `<p>Regards,<br>${escapeHtml(tenantName || "Admissions Office")}</p>`,
  ].join("");
  return { subject, html };
}

function interviewEmail({ applicant, when, mode, panel, cancelled = false, tenantName }) {
  const name = applicantDisplayName(applicant);
  const subject = cancelled
    ? `Admission interview cancelled • ${str(applicant?.applicationId, 80)}`
    : `Admission interview scheduled • ${str(applicant?.applicationId, 80)}`;
  const whenText = when instanceof Date && !Number.isNaN(when.getTime()) ? when.toLocaleString("en-GB") : "To be confirmed";
  const html = cancelled
    ? `<p>Hello ${escapeHtml(name)},</p><p>Your admission interview scheduled for ${escapeHtml(whenText)} has been cancelled. The Admissions Office will contact you with any next steps.</p><p>Regards,<br>${escapeHtml(tenantName || "Admissions Office")}</p>`
    : `<p>Hello ${escapeHtml(name)},</p><p>Your admission interview has been scheduled.</p><p><strong>Date/time:</strong> ${escapeHtml(whenText)}<br><strong>Mode:</strong> ${escapeHtml(mode || "in-person")}<br><strong>Panel:</strong> ${escapeHtml(panel || "Admissions")}</p><p>Regards,<br>${escapeHtml(tenantName || "Admissions Office")}</p>`;
  return { subject, html };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  APPLICANT_STATUSES,
  CHECKLIST_KEYS,
  CONVERSION_LEASE_MS,
  DOC_KEYS,
  INTERVIEW_MODES,
  REQUIRED_DOC_KEYS,
  REQUEST_CHANNELS,
  allocateApplicationId,
  allocateOfferLetterNo,
  claimApplicantConversion,
  applicantDisplayName,
  applicationIdCandidate,
  assertApplicantTransition,
  canTransitionApplicantStatus,
  cleanEmail,
  csvCell,
  documentCompleteness,
  documentLabel,
  finalizeApplicantConversion,
  escapeHtml,
  escapeRegex,
  hasStoredDoc,
  interviewEmail,
  isVerifiedDoc,
  normalizeChecklist,
  normalizeInterviewMode,
  normalizeRequestChannel,
  normalizeRequestedDocKeys,
  normalizeStatus,
  offerLetterNoCandidate,
  releaseApplicantConversion,
  requestDocsEmail,
  sanitizeTags,
  str,
};
