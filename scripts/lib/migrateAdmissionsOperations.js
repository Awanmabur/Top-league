const {
  INTAKE_STATUSES,
  REQUIREMENT_CATEGORIES,
  normalizeIntakeProgramRows,
  offerContentHash,
  offerCurrentKey,
  str,
} = require('../../src/services/tenant/admissionsOperationsService');

function positiveRevision(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function validDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function id(value) {
  return String(value?._id || value || '');
}

function eqArray(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

async function readAll(Model) {
  if (!Model) return [];
  return Model.find({}).sort({ createdAt: 1, _id: 1 }).lean();
}

async function migrateIntakes(Intake) {
  const rows = await readAll(Intake);
  let normalized = 0;
  let duplicateActivesCleared = 0;

  const activeCandidates = rows
    .filter((row) => row.isDeleted !== true && row.isActive === true && row.status === 'open')
    .sort((a, b) => {
      const aa = validDate(a.activatedAt)?.getTime() || validDate(a.updatedAt)?.getTime() || validDate(a.createdAt)?.getTime() || 0;
      const bb = validDate(b.activatedAt)?.getTime() || validDate(b.updatedAt)?.getTime() || validDate(b.createdAt)?.getTime() || 0;
      return bb - aa || id(a).localeCompare(id(b));
    });
  const keeperActive = activeCandidates[0] ? id(activeCandidates[0]) : '';

  for (const row of rows) {
    const patch = {};
    const status = INTAKE_STATUSES.includes(str(row.status, 20)) ? str(row.status, 20) : 'draft';
    if (status !== row.status) patch.status = status;
    const rev = positiveRevision(row.revision);
    if (rev !== row.revision) patch.revision = rev;

    const programs = normalizeIntakeProgramRows(row.programs || []);
    const canonicalPrograms = programs.map((p) => ({
      program: p.program,
      capacity: p.capacity,
      isOpen: p.isOpen,
      notes: p.notes,
    }));
    const currentPrograms = (row.programs || []).map((p) => ({
      program: id(p.program),
      capacity: Math.max(0, Math.trunc(Number(p.capacity) || 0)),
      isOpen: p.isOpen !== false,
      notes: str(p.notes, 500),
    }));
    if (!eqArray(canonicalPrograms, currentPrograms)) patch.programs = canonicalPrograms;

    const appOpen = validDate(row.applicationOpenDate);
    const appClose = validDate(row.applicationCloseDate);
    const studyStart = validDate(row.startDate);
    const studyEnd = validDate(row.endDate);
    const invalidDates = (appOpen && appClose && appOpen > appClose) || (studyStart && studyEnd && studyStart > studyEnd);
    if (invalidDates) {
      patch.status = 'draft';
      patch.isActive = false;
    }

    const shouldBeActive = id(row) === keeperActive && (patch.status || status) === 'open' && !invalidDates;
    if (Boolean(row.isActive) !== shouldBeActive) {
      patch.isActive = shouldBeActive;
      if (row.isActive && !shouldBeActive) duplicateActivesCleared += 1;
    }
    if ((patch.status || status) !== 'open' && row.isActive === true) patch.isActive = false;

    if (Object.keys(patch).length) {
      await Intake.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized, duplicateActivesCleared };
}

async function migrateRequirements(AdmissionRequirement, Section, Intake) {
  const rows = await readAll(AdmissionRequirement);
  const validSections = new Set((await readAll(Section)).filter((r) => r.isDeleted !== true && r.isArchived !== true).map(id));
  const validIntakes = new Set((await readAll(Intake)).filter((r) => r.isDeleted !== true).map(id));
  let normalized = 0;
  let quarantined = 0;

  for (const row of rows) {
    const patch = {};
    const rev = positiveRevision(row.revision);
    if (rev !== row.revision) patch.revision = rev;
    const category = REQUIREMENT_CATEGORIES.includes(str(row.category, 20)) ? str(row.category, 20) : 'other';
    if (category !== row.category) patch.category = category;
    const currency = /^[A-Z]{3,10}$/.test(str(row.currency, 10).toUpperCase()) ? str(row.currency, 10).toUpperCase() : 'UGX';
    if (currency !== row.currency) patch.currency = currency;
    const feeAmount = Math.max(0, Number(row.feeAmount) || 0);
    if (feeAmount !== row.feeAmount) patch.feeAmount = feeAmount;

    const programs = [...new Set((row.programs || []).map(id).filter((x) => validSections.has(x)))];
    const intakes = [...new Set((row.intakes || []).map(id).filter((x) => validIntakes.has(x)))];
    if (!eqArray(programs, (row.programs || []).map(id))) patch.programs = programs;
    if (!eqArray(intakes, (row.intakes || []).map(id))) patch.intakes = intakes;

    const reasons = [];
    if (row.appliesToAllPrograms !== true && !programs.length) reasons.push('Specific-section scope has no resolvable Section.');
    if (row.appliesToAllIntakes !== true && !intakes.length) reasons.push('Specific-intake scope has no resolvable Intake.');
    if (reasons.length) {
      patch.isActive = false;
      patch.migrationQuarantined = true;
      patch.quarantineReason = reasons.join(' ').slice(0, 500);
      quarantined += row.migrationQuarantined === true ? 0 : 1;
    } else if (row.migrationQuarantined === true) {
      // Never auto-reactivate; only clear quarantine evidence when the scope itself is now valid.
      patch.migrationQuarantined = false;
      patch.quarantineReason = '';
    }

    if (Object.keys(patch).length) {
      await AdmissionRequirement.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized, quarantined };
}

function offerRank(letter) {
  if (letter.status === 'sent' || letter.sentAt) return 3;
  if (letter.status === 'draft') return 2;
  return 1;
}

async function migrateTemplates(OfferLetterTemplate) {
  const rows = await readAll(OfferLetterTemplate);
  let normalized = 0;
  if (!rows.length) return { scanned: 0, normalized: 0, singletonChosen: 0 };
  const candidates = rows.filter((r) => r.isDeleted !== true);
  const keeper = candidates.find((r) => r.isActive === true) || candidates[0] || null;
  for (const row of rows) {
    const patch = {};
    const rev = positiveRevision(row.revision);
    if (rev !== row.revision) patch.revision = rev;
    const keep = keeper && id(row) === id(keeper);
    const desiredKey = keep ? 'default' : null;
    if ((row.singletonKey || null) !== desiredKey) patch.singletonKey = desiredKey;
    if (!keep && row.isActive === true) patch.isActive = false;
    if (Object.keys(patch).length) {
      await OfferLetterTemplate.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized, singletonChosen: keeper ? 1 : 0 };
}

async function migrateOffers(OfferLetter) {
  const rows = await readAll(OfferLetter);
  let normalized = 0;
  let duplicateCurrentVoided = 0;
  const groups = new Map();

  for (const row of rows) {
    if (row.isDeleted === true || row.status === 'void' || !id(row.applicant)) continue;
    let key;
    try { key = offerCurrentKey(id(row.applicant), id(row.intakeId) || null); }
    catch (_) { continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const keepByKey = new Map();
  for (const [key, list] of groups) {
    list.sort((a, b) => offerRank(b) - offerRank(a)
      || (validDate(b.sentAt)?.getTime() || validDate(b.issuedAt)?.getTime() || validDate(b.createdAt)?.getTime() || 0)
       - (validDate(a.sentAt)?.getTime() || validDate(a.issuedAt)?.getTime() || validDate(a.createdAt)?.getTime() || 0)
      || id(a).localeCompare(id(b)));
    keepByKey.set(key, id(list[0]));
  }

  for (const row of rows) {
    const patch = {};
    const rev = positiveRevision(row.revision);
    if (rev !== row.revision) patch.revision = rev;
    const status = ['draft', 'sent', 'void'].includes(str(row.status, 20)) ? str(row.status, 20) : (row.sentAt ? 'sent' : 'draft');
    if (status !== row.status) patch.status = status;
    const expectedHash = offerContentHash(row.subject || '', row.bodyHtml || '');
    if (row.contentHash !== expectedHash) patch.contentHash = expectedHash;

    let key = null;
    if (row.isDeleted !== true && status !== 'void' && id(row.applicant)) {
      try { key = offerCurrentKey(id(row.applicant), id(row.intakeId) || null); } catch (_) { key = null; }
    }
    if (key && keepByKey.get(key) !== id(row)) {
      patch.status = 'void';
      patch.currentKey = null;
      patch.voidedAt = row.voidedAt || new Date();
      patch.voidReason = str(row.voidReason, 500) || 'Migration: duplicate current offer superseded.';
      patch.sendClaimToken = '';
      patch.sendClaimAt = null;
      duplicateCurrentVoided += status === 'void' ? 0 : 1;
    } else if ((row.currentKey || null) !== key) patch.currentKey = key;

    const effectiveStatus = patch.status || status;
    if (row.deliveryStatus === 'sending') {
      // Preserve uncertain in-flight state. Operators must reconcile it manually; never reset to resendable.
    } else {
      const desiredDelivery = effectiveStatus === 'sent' || row.sentAt ? 'sent' : 'not_sent';
      if (row.deliveryStatus !== desiredDelivery) patch.deliveryStatus = desiredDelivery;
      if (desiredDelivery !== 'sending') {
        if (row.sendClaimToken) patch.sendClaimToken = '';
        if (row.sendClaimAt) patch.sendClaimAt = null;
      }
    }
    if (!Number.isFinite(Number(row.sendAttempts)) || Number(row.sendAttempts) < 0) patch.sendAttempts = 0;

    if (Object.keys(patch).length) {
      await OfferLetter.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized, duplicateCurrentVoided };
}

async function migrateAdmissionsOperations(models = {}) {
  const intakes = await migrateIntakes(models.Intake);
  const requirements = await migrateRequirements(models.AdmissionRequirement, models.Section, models.Intake);
  const templates = await migrateTemplates(models.OfferLetterTemplate);
  const offers = await migrateOffers(models.OfferLetter);
  return { intakes, requirements, templates, offers };
}

module.exports = {
  migrateAdmissionsOperations,
  migrateIntakes,
  migrateOffers,
  migrateRequirements,
  migrateTemplates,
};
