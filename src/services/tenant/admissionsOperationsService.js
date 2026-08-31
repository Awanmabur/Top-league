const crypto = require('crypto');
const { splitCsvRecords, validateCsvBuffer, positiveRevision } = require('./reportControlService');

const INTAKE_STATUSES = Object.freeze(['draft', 'open', 'closed', 'archived']);
const REQUIREMENT_CATEGORIES = Object.freeze(['document', 'fee', 'exam', 'medical', 'other']);
const OFFER_STATUSES = Object.freeze(['draft', 'sent', 'void']);
const DELIVERY_STATUSES = Object.freeze(['not_sent', 'sending', 'sent', 'failed']);

function str(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function objectIdString(value) {
  const text = str(value, 40);
  return /^[a-f\d]{24}$/i.test(text) ? text : null;
}

function number(value, fallback = 0, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseCsvRecord(record) {
  const fields = [];
  let out = '';
  let quoted = false;
  for (let i = 0; i < String(record || '').length; i += 1) {
    const ch = record[i];
    if (ch === '"') {
      if (quoted && record[i + 1] === '"') { out += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      fields.push(out);
      out = '';
    } else out += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  fields.push(out);
  return fields;
}

function parseCsvBuffer(buffer, opts = {}) {
  const validated = validateCsvBuffer(buffer, {
    maxBytes: opts.maxBytes || 1024 * 1024,
    maxRows: opts.maxRows || 1000,
  });
  const records = splitCsvRecords(validated.text);
  const headers = parseCsvRecord(records.shift()).map((x) => str(x, 80).toLowerCase());
  const rows = records.map((record, index) => {
    const cells = parseCsvRecord(record);
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} columns; expected ${headers.length}.`);
    const row = {};
    headers.forEach((header, i) => { if (header) row[header] = cells[i]; });
    return row;
  });
  return { headers, rows };
}

function normalizeIntakeProgramRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const program = objectIdString(row && row.program);
    if (!program || seen.has(program)) continue;
    seen.add(program);
    out.push({
      program,
      capacity: Math.trunc(number(row && row.capacity, 0, 0, 1_000_000)),
      isOpen: bool(row && row.isOpen, true),
      notes: str(row && row.notes, 500),
    });
  }
  return out;
}

function validateIntakeDates(input = {}) {
  const open = input.applicationOpenDate instanceof Date ? input.applicationOpenDate : null;
  const close = input.applicationCloseDate instanceof Date ? input.applicationCloseDate : null;
  const start = input.startDate instanceof Date ? input.startDate : null;
  const end = input.endDate instanceof Date ? input.endDate : null;
  if (open && close && open.getTime() > close.getTime()) throw new Error('Application open date must be on or before the close date.');
  if (start && end && start.getTime() > end.getTime()) throw new Error('Intake start date must be on or before the end date.');
  return true;
}

function canTransitionIntake(fromValue, toValue) {
  const from = INTAKE_STATUSES.includes(str(fromValue, 20)) ? str(fromValue, 20) : 'draft';
  const to = INTAKE_STATUSES.includes(str(toValue, 20)) ? str(toValue, 20) : '';
  if (!to) return false;
  if (from === to) return true;
  if (from === 'archived') return false;
  const allowed = {
    draft: new Set(['open', 'archived']),
    open: new Set(['draft', 'closed']),
    closed: new Set(['open', 'archived']),
  };
  return Boolean(allowed[from]?.has(to));
}

function assertIntakeTransition(fromValue, toValue) {
  if (!canTransitionIntake(fromValue, toValue)) throw new Error(`Intake status cannot move from ${str(fromValue, 20) || 'draft'} to ${str(toValue, 20)}.`);
  return str(toValue, 20);
}

function isIntakePubliclyOpen(intake, now = new Date()) {
  if (!intake || intake.isDeleted === true || str(intake.status, 20) !== 'open') return false;
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const open = intake.applicationOpenDate ? new Date(intake.applicationOpenDate).getTime() : null;
  const close = intake.applicationCloseDate ? new Date(intake.applicationCloseDate).getTime() : null;
  if (open && Number.isFinite(open) && time < open) return false;
  if (close && Number.isFinite(close) && time > close) return false;
  return true;
}

function intakeAllowsSection(intake, sectionId) {
  if (!intake) return false;
  const section = objectIdString(sectionId);
  if (!section) return false;
  const configured = Array.isArray(intake.programs) ? intake.programs : [];
  if (!configured.length) return true;
  return configured.some((row) => String(row?.program?._id || row?.program || '') === section && row?.isOpen !== false);
}

function normalizeRequirementScope(input = {}) {
  const appliesToAllPrograms = bool(input.appliesToAllPrograms, false);
  const appliesToAllIntakes = bool(input.appliesToAllIntakes, false);
  const programs = appliesToAllPrograms ? [] : [...new Set((Array.isArray(input.programs) ? input.programs : [input.programs]).map(objectIdString).filter(Boolean))];
  const intakes = appliesToAllIntakes ? [] : [...new Set((Array.isArray(input.intakes) ? input.intakes : [input.intakes]).map(objectIdString).filter(Boolean))];
  if (!appliesToAllPrograms && !programs.length) throw new Error('Select at least one Section or enable all Sections.');
  if (!appliesToAllIntakes && !intakes.length) throw new Error('Select at least one Intake or enable all Intakes.');
  return { appliesToAllPrograms, programs, appliesToAllIntakes, intakes };
}

function requirementApplies(requirement, sectionId, intakeId) {
  if (!requirement || requirement.isDeleted === true || requirement.isActive === false) return false;
  const section = objectIdString(sectionId);
  const intake = objectIdString(intakeId);
  const programs = Array.isArray(requirement.programs) ? requirement.programs.map((x) => String(x?._id || x)) : [];
  const intakes = Array.isArray(requirement.intakes) ? requirement.intakes.map((x) => String(x?._id || x)) : [];
  const sectionOk = requirement.appliesToAllPrograms === true || (section && programs.includes(section));
  const intakeOk = requirement.appliesToAllIntakes === true || (intake && intakes.includes(intake));
  return Boolean(sectionOk && intakeOk);
}

function requirementSnapshot(requirements, sectionId, intakeId) {
  return (Array.isArray(requirements) ? requirements : [])
    .filter((row) => requirementApplies(row, sectionId, intakeId))
    .sort((a, b) => number(a.sortOrder) - number(b.sortOrder) || str(a.title).localeCompare(str(b.title)))
    .map((row) => ({
      requirementId: row._id || null,
      code: str(row.code, 40),
      title: str(row.title, 120),
      category: REQUIREMENT_CATEGORIES.includes(str(row.category, 20)) ? str(row.category, 20) : 'other',
      description: str(row.description, 700),
      isMandatory: row.isMandatory !== false,
      feeAmount: number(row.feeAmount, 0, 0, 1_000_000_000),
      currency: /^[A-Z]{3,10}$/.test(str(row.currency, 10).toUpperCase()) ? str(row.currency, 10).toUpperCase() : 'UGX',
    }));
}

function offerContentHash(subject, bodyHtml) {
  return crypto.createHash('sha256').update(`${String(subject ?? '')}\n${String(bodyHtml ?? '')}`, 'utf8').digest('hex');
}

function offerCurrentKey(applicantId, intakeId) {
  const applicant = objectIdString(applicantId);
  if (!applicant) throw new Error('Applicant id is invalid.');
  const intake = objectIdString(intakeId) || 'none';
  return `${applicant}:${intake}`;
}

function sendClaimToken() {
  return crypto.randomBytes(18).toString('hex');
}

function offerSendState(letter, now = new Date()) {
  if (!letter || letter.isDeleted === true) return { allowed: false, reason: 'Offer letter is unavailable.' };
  if (str(letter.status, 20) === 'void') return { allowed: false, reason: 'This offer letter is void.' };
  if (str(letter.status, 20) === 'sent' || str(letter.deliveryStatus, 20) === 'sent') return { allowed: false, reason: 'This offer letter has already been sent.' };
  if (str(letter.deliveryStatus, 20) === 'sending') return { allowed: false, reason: 'This offer letter already has a delivery in progress or awaiting reconciliation.' };
  return { allowed: true, now: now instanceof Date ? now : new Date(now) };
}

module.exports = {
  DELIVERY_STATUSES,
  INTAKE_STATUSES,
  OFFER_STATUSES,
  REQUIREMENT_CATEGORIES,
  assertIntakeTransition,
  bool,
  canTransitionIntake,
  intakeAllowsSection,
  isIntakePubliclyOpen,
  normalizeIntakeProgramRows,
  normalizeRequirementScope,
  number,
  objectIdString,
  offerContentHash,
  offerCurrentKey,
  offerSendState,
  parseCsvBuffer,
  parseCsvRecord,
  positiveRevision,
  requirementApplies,
  requirementSnapshot,
  sendClaimToken,
  str,
  validateIntakeDates,
};
