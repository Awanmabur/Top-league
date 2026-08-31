const crypto = require('crypto');
const mongoose = require('mongoose');
const { makeApplicationId } = require('../../utils/id');

const SCHOLARSHIP_STATUSES = ['Active', 'Inactive', 'Expired', 'Revoked'];
const APPLICATION_STATUSES = ['submitted', 'under_review', 'shortlisted', 'awarded', 'rejected', 'withdrawn'];
const TERMINAL_APPLICATION_STATUSES = new Set(['awarded', 'rejected', 'withdrawn']);

const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const isValidId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeEmail(v) { return str(v, 160).toLowerCase(); }
function normalizePhone(v) { return str(v, 60).replace(/[\s()-]/g, ''); }
function normalizeRegNo(v) { return str(v, 80).toUpperCase().replace(/\s+/g, ' '); }
function applicantKey(input = {}) {
  if (input.student && isValidId(input.student)) return `student:${String(input.student)}`;
  const regNo = normalizeRegNo(input.regNo);
  if (regNo) return `reg:${regNo}`;
  const email = normalizeEmail(input.email);
  if (email) return `email:${email}`;
  const phone = normalizePhone(input.phone);
  if (phone) return `phone:${phone}`;
  return '';
}

function isDateOpen(doc, now = new Date()) {
  const start = doc?.startDate ? new Date(doc.startDate) : null;
  const end = doc?.endDate ? new Date(doc.endDate) : null;
  if (start && !Number.isNaN(start.getTime()) && start > now) return false;
  if (end && !Number.isNaN(end.getTime()) && end < now) return false;
  return true;
}

function isPublicScholarship(doc, now = new Date()) {
  return !!doc && doc.isDeleted !== true && doc.status === 'Active' && !doc.studentId && isDateOpen(doc, now);
}

function publicScholarshipFilter(now = new Date()) {
  return {
    isDeleted: { $ne: true },
    status: 'Active',
    studentId: null,
    $and: [
      { $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }] },
    ],
  };
}

function toPublicScholarship(doc) {
  if (!doc) return null;
  const p = doc.programId || null;
  const requirements = [];
  if (p) requirements.push(`Program: ${p.title || p.shortTitle || p.name || p.code || 'Eligible program'}`);
  if (doc.type === 'Percentage') requirements.push(`Award value: ${Number(doc.value || 0)}%`);
  if (doc.type === 'Full') requirements.push('Award value: Full scholarship');
  if (doc.type === 'Fixed Amount') requirements.push(`Award amount: ${Number(doc.amount || 0).toLocaleString()} ${doc.currency || 'UGX'}`);
  return {
    ...doc,
    title: doc.name || 'Scholarship',
    provider: doc.sponsor || '',
    category: doc.type || '',
    openDate: doc.startDate || null,
    closeDate: doc.endDate || null,
    description: doc.notes || '',
    requirements,
    programs: p ? [p] : [],
  };
}

function validateApplicationTransition(from, to) {
  if (!APPLICATION_STATUSES.includes(to)) throw new Error('Invalid scholarship application status.');
  if (!APPLICATION_STATUSES.includes(from)) from = 'submitted';
  if (from === to) return true;
  if (TERMINAL_APPLICATION_STATUSES.has(from)) throw new Error(`A ${from} application is terminal.`);
  const allowed = {
    submitted: new Set(['under_review', 'shortlisted', 'rejected', 'withdrawn']),
    under_review: new Set(['shortlisted', 'rejected', 'withdrawn']),
    shortlisted: new Set(['awarded', 'rejected', 'withdrawn']),
  };
  if (!allowed[from]?.has(to)) throw new Error(`Cannot move scholarship application from ${from} to ${to}.`);
  return true;
}

function applyApplicationStatus(app, status, actorId, now = new Date()) {
  const from = app.status || 'submitted';
  validateApplicationTransition(from, status);
  app.status = status;
  app.updatedBy = actorId || null;
  if (status === 'under_review' && !app.reviewedAt) { app.reviewedAt = now; app.reviewedBy = actorId || null; }
  if (status === 'shortlisted' && !app.shortlistedAt) app.shortlistedAt = now;
  if (status === 'awarded' && !app.awardedAt) { app.awardedAt = now; app.decisionBy = actorId || null; }
  if (status === 'rejected' && !app.rejectedAt) { app.rejectedAt = now; app.decisionBy = actorId || null; }
  if (status === 'withdrawn' && !app.withdrawnAt) app.withdrawnAt = now;
}

function safeDocUrl(value) {
  const raw = str(value, 1000);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return ['https:', 'http:'].includes(u.protocol) ? u.toString() : '';
  } catch (_) { return ''; }
}

function assertFileSignature(file) {
  if (!file?.buffer) throw new Error('Missing uploaded file.');
  const b = file.buffer;
  const type = String(file.mimetype || '').toLowerCase();
  const pdf = b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-';
  const jpeg = b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = b.length >= 12 && b.subarray(0,4).toString('ascii') === 'RIFF' && b.subarray(8,12).toString('ascii') === 'WEBP';
  const ok = (type === 'application/pdf' && pdf) || (['image/jpeg','image/jpg'].includes(type) && jpeg) || (type === 'image/png' && png) || (type === 'image/webp' && webp);
  if (!ok) throw new Error(`Uploaded file ${str(file.originalname, 160) || 'document'} does not match its allowed file type.`);
  return true;
}

async function allocateApplicationId(Application) {
  for (let i = 0; i < 20; i += 1) {
    const value = makeApplicationId();
    // precheck only reduces retries; unique-index collision remains handled by caller
    // eslint-disable-next-line no-await-in-loop
    if (!(await Application.exists({ applicationId: value, isDeleted: { $ne: true } }))) return value;
  }
  return `APP-${new Date().getUTCFullYear()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

module.exports = {
  SCHOLARSHIP_STATUSES,
  APPLICATION_STATUSES,
  TERMINAL_APPLICATION_STATUSES,
  str,
  isValidId,
  escapeRegex,
  normalizeEmail,
  normalizePhone,
  normalizeRegNo,
  applicantKey,
  isDateOpen,
  isPublicScholarship,
  publicScholarshipFilter,
  toPublicScholarship,
  validateApplicationTransition,
  applyApplicationStatus,
  safeDocUrl,
  assertFileSignature,
  allocateApplicationId,
  csvCell,
};
