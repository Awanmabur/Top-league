const { dateOnlyBoundary } = require('../../../services/tenant/reportControlService');
const {
  INTAKE_STATUSES,
  assertIntakeTransition,
  bool,
  normalizeIntakeProgramRows,
  objectIdString,
  parseCsvBuffer,
  positiveRevision,
  str,
  validateIntakeDates,
} = require('../../../services/tenant/admissionsOperationsService');

function parseDate(value, timezone = 'UTC', end = false) {
  const text = str(value, 40);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dateOnlyBoundary(text, timezone || 'UTC', end);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function slugPart(value) {
  return str(value, 100).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 4);
}

async function buildUniqueTermCode(Intake, { name = '', term = '', year = null, excludeId = null } = {}) {
  const base = [slugPart(term || name) || 'TERM', String(year || new Date().getFullYear()).slice(-2)].filter(Boolean).join('');
  for (let counter = 1; counter < 10000; counter += 1) {
    const code = `${base}${String(counter).padStart(2, '0')}`;
    const query = { code, isDeleted: { $ne: true } };
    if (excludeId) query._id = { $ne: excludeId };
    const exists = await Intake.findOne(query).select('_id').lean();
    if (!exists) return code;
  }
  throw new Error('Unable to allocate a unique Intake code.');
}

function programsFromBody(body = {}) {
  if (body.programsJson) {
    try {
      const parsed = JSON.parse(String(body.programsJson));
      if (Array.isArray(parsed)) return normalizeIntakeProgramRows(parsed);
    } catch (_) {
      throw new Error('Intake Section configuration is invalid. Reload and try again.');
    }
  }
  const ids = Array.isArray(body.program) ? body.program : body.program ? [body.program] : [];
  const capacities = Array.isArray(body.capacity) ? body.capacity : body.capacity != null ? [body.capacity] : [];
  const open = Array.isArray(body.isOpen) ? body.isOpen : body.isOpen != null ? [body.isOpen] : [];
  const notes = Array.isArray(body.pnotes) ? body.pnotes : body.pnotes != null ? [body.pnotes] : [];
  return normalizeIntakeProgramRows(ids.map((program, i) => ({ program, capacity: capacities[i], isOpen: open[i], notes: notes[i] })));
}

async function assertSectionsExist(Section, programs) {
  const ids = programs.map((row) => row.program);
  if (!ids.length) return;
  const count = await Section.countDocuments({ _id: { $in: ids }, status: { $ne: 'archived' } });
  if (count !== ids.length) throw new Error('One or more selected Sections are unavailable or archived.');
}

function intakePatch(req, current = null) {
  const timezone = req.tenant?.timezone || 'UTC';
  const name = str(req.body.name || req.body.termName || req.body.title, 160);
  if (name.length < 2) throw new Error('Term name is required.');
  const year = req.body.year ? toInt(req.body.year, null) : null;
  if (year != null && (year < 1900 || year > 2200)) throw new Error('Academic year is invalid.');
  const term = str(req.body.term || req.body.termName || name, 80);
  const requestedStatus = str(req.body.status || current?.status || 'draft', 20).toLowerCase();
  if (!INTAKE_STATUSES.includes(requestedStatus)) throw new Error('Invalid Intake status.');
  const patch = {
    name,
    year,
    term,
    status: requestedStatus,
    applicationOpenDate: parseDate(req.body.applicationOpenDate, timezone, false),
    applicationCloseDate: parseDate(req.body.applicationCloseDate, timezone, true),
    startDate: parseDate(req.body.startDate, timezone, false),
    endDate: parseDate(req.body.endDate, timezone, true),
    programs: programsFromBody(req.body),
    notes: str(req.body.notes, 2000),
  };
  validateIntakeDates(patch);
  return patch;
}

function responseError(req, res, message, status = 400) {
  if (req.flash) {
    req.flash('error', message);
    return res.redirect('/admin/admissions/intakes');
  }
  return res.status(status).send(message);
}

async function dependencyCounts(models, intakeId) {
  const { Applicant, OfferLetter, AdmissionRequirement } = models;
  const [applicants, letters, requirements] = await Promise.all([
    Applicant ? Applicant.countDocuments({ intakeId, isDeleted: { $ne: true } }) : 0,
    OfferLetter ? OfferLetter.countDocuments({ intakeId, isDeleted: { $ne: true } }) : 0,
    AdmissionRequirement ? AdmissionRequirement.countDocuments({ intakes: intakeId, isDeleted: { $ne: true } }) : 0,
  ]);
  return { applicants, letters, requirements, total: applicants + letters + requirements };
}

module.exports = {
  async index(req, res) {
    try {
      const { Intake, Section, Applicant } = req.models || {};
      if (!Intake || !Section || !Applicant) throw new Error('Intake models are not fully loaded.');
      const q = str(req.query.q, 120);
      const status = str(req.query.status, 20);
      const filter = { isDeleted: { $ne: true } };
      if (q) {
        const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [{ name: new RegExp(safe, 'i') }, { code: new RegExp(safe, 'i') }, { term: new RegExp(safe, 'i') }];
      }
      if (INTAKE_STATUSES.includes(status)) filter.status = status;
      const [items, programs, counts] = await Promise.all([
        Intake.find(filter).sort({ isActive: -1, createdAt: -1 }).lean(),
        Section.find({ status: { $ne: 'archived' } }).sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 }).lean(),
        Applicant.aggregate([
          { $match: { isDeleted: { $ne: true }, intakeId: { $ne: null } } },
          { $group: { _id: '$intakeId', count: { $sum: 1 } } },
        ]),
      ]);
      const applicantCounts = Object.fromEntries(counts.map((row) => [String(row._id), Number(row.count || 0)]));
      return res.render('tenant/intakes/index', {
        tenant: req.tenant,
        items,
        programs,
        applicantCounts,
        csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : '',
        query: { q, status },
      });
    } catch (err) {
      console.error('[INTAKES:index]', err);
      return res.status(500).send('Failed to load intakes.');
    }
  },

  async newPage(req, res) { return res.redirect('/admin/admissions/intakes'); },
  async editPage(req, res) { return res.redirect('/admin/admissions/intakes'); },

  async create(req, res) {
    try {
      const { Intake, Section } = req.models || {};
      if (!Intake || !Section) throw new Error('Intake models are unavailable.');
      const patch = intakePatch(req);
      await assertSectionsExist(Section, patch.programs);
      const wantsActive = bool(req.body.isActive, false);
      if (wantsActive && patch.status !== 'open') throw new Error('Only an open Intake can be active.');
      if (wantsActive && await Intake.exists({ isDeleted: { $ne: true }, isActive: true })) throw new Error('Another Intake is already active. Use Set Active to switch it safely.');
      const code = await buildUniqueTermCode(Intake, patch);
      const now = new Date();
      await Intake.create({
        ...patch,
        code,
        isActive: wantsActive,
        activatedAt: wantsActive ? now : null,
        openedAt: patch.status === 'open' ? now : null,
        closedAt: patch.status === 'closed' ? now : null,
        archivedAt: patch.status === 'archived' ? now : null,
        revision: 1,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });
      req.flash?.('success', 'Intake created.');
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      console.error('[INTAKES:create]', err);
      const message = String(err?.code) === '11000' ? 'Intake code or active Intake conflicts with an existing record.' : (err.message || 'Failed to create Intake.');
      return responseError(req, res, message, String(err?.code) === '11000' ? 409 : 400);
    }
  },

  async update(req, res) {
    try {
      const { Intake, Section } = req.models || {};
      const id = objectIdString(req.params.id);
      const revision = positiveRevision(req.body.revision);
      if (!id || !revision) throw new Error('A current Intake revision is required. Reload and try again.');
      const current = await Intake.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!current) return res.status(404).send('Intake not found.');
      const patch = intakePatch(req, current);
      assertIntakeTransition(current.status, patch.status);
      await assertSectionsExist(Section, patch.programs);
      if (current.isActive && patch.status !== 'open') throw new Error('Switch the active Intake before closing, drafting, or archiving it.');
      const now = new Date();
      if (patch.status !== current.status) {
        if (patch.status === 'open') patch.openedAt = now;
        if (patch.status === 'closed') patch.closedAt = now;
        if (patch.status === 'archived') patch.archivedAt = now;
      }
      patch.updatedBy = req.user?._id || null;
      const result = await Intake.updateOne({ _id: id, isDeleted: { $ne: true }, revision }, { $set: patch, $inc: { revision: 1 } });
      if (result.modifiedCount !== 1) throw new Error('This Intake changed while you were editing it. Reload and try again.');
      req.flash?.('success', 'Intake updated.');
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      console.error('[INTAKES:update]', err);
      return responseError(req, res, err.message || 'Failed to update Intake.', 409);
    }
  },

  async setActive(req, res) {
    const { Intake } = req.models || {};
    const id = objectIdString(req.params.id);
    const revision = positiveRevision(req.body.revision);
    if (!id || !revision) return responseError(req, res, 'A current Intake revision is required. Reload and try again.', 409);
    let prior = null;
    let priorDeactivated = false;
    try {
      const target = await Intake.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!target) return res.status(404).send('Intake not found.');
      if (Number(target.revision || 1) !== revision) throw new Error('This Intake changed while you were viewing it. Reload and try again.');
      if (target.status !== 'open') throw new Error('Only an open Intake can be made active.');
      if (target.isActive) {
        req.flash?.('success', 'This Intake is already active.');
        return res.redirect('/admin/admissions/intakes');
      }
      prior = await Intake.findOne({ _id: { $ne: id }, isDeleted: { $ne: true }, isActive: true }).lean();
      if (prior) {
        const off = await Intake.updateOne({ _id: prior._id, isActive: true, revision: Number(prior.revision || 1) }, { $set: { isActive: false, updatedBy: req.user?._id || null }, $inc: { revision: 1 } });
        if (off.modifiedCount !== 1) throw new Error('The active Intake changed concurrently. Reload and try again.');
        priorDeactivated = true;
      }
      const on = await Intake.updateOne({ _id: id, revision, status: 'open', isDeleted: { $ne: true }, isActive: { $ne: true } }, { $set: { isActive: true, activatedAt: new Date(), updatedBy: req.user?._id || null }, $inc: { revision: 1 } });
      if (on.modifiedCount !== 1) throw new Error('This Intake changed concurrently. Reload and try again.');
      req.flash?.('success', 'Active Intake changed.');
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      if (prior && priorDeactivated) {
        try {
          await Intake.updateOne({ _id: prior._id, isActive: false, revision: Number(prior.revision || 1) + 1 }, { $set: { isActive: true }, $inc: { revision: 1 } });
        } catch (_) {}
      }
      console.error('[INTAKES:setActive]', err);
      return responseError(req, res, String(err?.code) === '11000' ? 'Another Intake became active concurrently. Reload and try again.' : (err.message || 'Failed to set active Intake.'), 409);
    }
  },

  async setStatus(req, res) {
    try {
      const { Intake } = req.models || {};
      const id = objectIdString(req.params.id);
      const revision = positiveRevision(req.body.revision);
      const next = str(req.body.status, 20);
      if (!id || !revision) throw new Error('A current Intake revision is required. Reload and try again.');
      if (!INTAKE_STATUSES.includes(next)) throw new Error('Invalid Intake status.');
      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!item) return res.status(404).send('Intake not found.');
      assertIntakeTransition(item.status, next);
      if (item.isActive && next !== 'open') throw new Error('Switch the active Intake before changing its status.');
      const patch = { status: next, updatedBy: req.user?._id || null };
      const now = new Date();
      if (next === 'open') patch.openedAt = now;
      if (next === 'closed') patch.closedAt = now;
      if (next === 'archived') patch.archivedAt = now;
      const result = await Intake.updateOne({ _id: id, revision, isDeleted: { $ne: true } }, { $set: patch, $inc: { revision: 1 } });
      if (result.modifiedCount !== 1) throw new Error('This Intake changed concurrently. Reload and try again.');
      req.flash?.('success', 'Intake status updated.');
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      console.error('[INTAKES:setStatus]', err);
      return responseError(req, res, err.message || 'Failed to change Intake status.', 409);
    }
  },

  async remove(req, res) {
    try {
      const { Intake } = req.models || {};
      const id = objectIdString(req.params.id);
      const revision = positiveRevision(req.body.revision);
      if (!id || !revision) throw new Error('A current Intake revision is required. Reload and try again.');
      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!item) return res.status(404).send('Intake not found.');
      if (item.isActive) throw new Error('The active Intake cannot be deleted. Switch the active Intake first.');
      const deps = await dependencyCounts(req.models, id);
      if (deps.total) throw new Error(`This Intake is referenced by ${deps.applicants} applicant(s), ${deps.letters} offer letter(s), and ${deps.requirements} requirement(s). Archive it instead.`);
      const result = await Intake.updateOne({ _id: id, revision, isDeleted: { $ne: true } }, { $set: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedBy: req.user?._id || null }, $inc: { revision: 1 } });
      if (result.modifiedCount !== 1) throw new Error('This Intake changed concurrently. Reload and try again.');
      req.flash?.('success', 'Intake deleted.');
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      console.error('[INTAKES:remove]', err);
      return responseError(req, res, err.message || 'Failed to delete Intake.', 409);
    }
  },

  async importCsv(req, res) {
    const createdIds = [];
    try {
      const { Intake } = req.models || {};
      if (!req.file?.buffer) throw new Error('Please choose a CSV file.');
      const { rows } = parseCsvBuffer(req.file.buffer, { maxBytes: 1024 * 1024, maxRows: 500 });
      const seenCodes = new Set();
      const prepared = [];
      let activeRows = 0;
      for (const [index, row] of rows.entries()) {
        const name = str(row.name, 160);
        const code = str(row.code, 40).toUpperCase().replace(/\s+/g, '-');
        const status = str(row.status || 'draft', 20).toLowerCase();
        if (!name || !code) throw new Error(`CSV row ${index + 2} requires name and code.`);
        if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw new Error(`CSV row ${index + 2} has an invalid code.`);
        if (!INTAKE_STATUSES.includes(status)) throw new Error(`CSV row ${index + 2} has an invalid status.`);
        if (seenCodes.has(code)) throw new Error(`CSV contains duplicate Intake code ${code}.`);
        seenCodes.add(code);
        const timezone = req.tenant?.timezone || 'UTC';
        const item = {
          name, code, status,
          year: row.year ? toInt(row.year, null) : null,
          term: str(row.term || name, 80),
          applicationOpenDate: parseDate(row.applicationopendate, timezone, false),
          applicationCloseDate: parseDate(row.applicationclosedate, timezone, true),
          startDate: parseDate(row.startdate, timezone, false),
          endDate: parseDate(row.enddate, timezone, true),
          isActive: bool(row.isactive, false),
          programs: [],
          revision: 1,
          createdBy: req.user?._id || null,
          updatedBy: req.user?._id || null,
        };
        validateIntakeDates(item);
        if (item.isActive) {
          activeRows += 1;
          if (status !== 'open') throw new Error(`CSV row ${index + 2}: only an open Intake can be active.`);
        }
        prepared.push(item);
      }
      if (activeRows > 1) throw new Error('CSV may contain at most one active Intake.');
      const existing = await Intake.find({ code: { $in: [...seenCodes] }, isDeleted: { $ne: true } }).select('code').lean();
      if (existing.length) throw new Error(`Intake code already exists: ${existing.map((x) => x.code).join(', ')}.`);
      if (activeRows && await Intake.exists({ isDeleted: { $ne: true }, isActive: true })) throw new Error('An active Intake already exists. Import the rows inactive, then use Set Active.');
      for (const item of prepared) {
        const created = await Intake.create(item);
        createdIds.push(created._id);
      }
      req.flash?.('success', `Import completed. Added ${createdIds.length} Intake(s).`);
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      if (createdIds.length) {
        try { await req.models.Intake.deleteMany({ _id: { $in: createdIds } }); } catch (_) {}
      }
      console.error('[INTAKES:importCsv]', err);
      req.flash?.('error', err.message || 'Failed to import Intakes.');
      return res.redirect('/admin/admissions/intakes');
    }
  },

  async bulkStatus(req, res) {
    const applied = [];
    try {
      const { Intake } = req.models || {};
      const status = str(req.body.status, 20);
      if (!INTAKE_STATUSES.includes(status)) throw new Error('Select a valid status.');
      let requested = [];
      try { requested = JSON.parse(String(req.body.items || '[]')); } catch (_) {}
      if (!Array.isArray(requested) || !requested.length) throw new Error('Select Intakes and reload if the selection is stale.');
      const normalized = requested.map((row) => ({ id: objectIdString(row?.id), revision: positiveRevision(row?.revision) }));
      if (normalized.some((row) => !row.id || !row.revision)) throw new Error('One or more selected Intake revisions are invalid. Reload and try again.');
      const docs = await Intake.find({ _id: { $in: normalized.map((x) => x.id) }, isDeleted: { $ne: true } }).lean();
      if (docs.length !== normalized.length) throw new Error('One or more selected Intakes no longer exist. Reload and try again.');
      const byId = new Map(docs.map((x) => [String(x._id), x]));
      for (const row of normalized) {
        const doc = byId.get(row.id);
        if (Number(doc.revision || 1) !== row.revision) throw new Error(`Intake ${doc.name || doc.code} changed concurrently. Reload and try again.`);
        assertIntakeTransition(doc.status, status);
        if (doc.isActive && status !== 'open') throw new Error(`Switch the active Intake (${doc.name || doc.code}) before changing its status.`);
      }
      for (const row of normalized) {
        const doc = byId.get(row.id);
        const patch = { status, updatedBy: req.user?._id || null };
        const now = new Date();
        if (status === 'open') patch.openedAt = now;
        if (status === 'closed') patch.closedAt = now;
        if (status === 'archived') patch.archivedAt = now;
        const result = await Intake.updateOne({ _id: row.id, revision: row.revision, isDeleted: { $ne: true } }, { $set: patch, $inc: { revision: 1 } });
        if (result.modifiedCount !== 1) throw new Error(`Intake ${doc.name || doc.code} changed concurrently.`);
        applied.push({ id: row.id, before: doc });
      }
      req.flash?.('success', 'Selected Intakes updated.');
      return res.redirect('/admin/admissions/intakes');
    } catch (err) {
      for (const row of applied.reverse()) {
        try {
          await req.models.Intake.updateOne(
            { _id: row.id, revision: Number(row.before.revision || 1) + 1 },
            { $set: { status: row.before.status, openedAt: row.before.openedAt || null, closedAt: row.before.closedAt || null, archivedAt: row.before.archivedAt || null }, $inc: { revision: 1 } },
          );
        } catch (_) {}
      }
      console.error('[INTAKES:bulkStatus]', err);
      req.flash?.('error', err.message || 'Bulk status update failed.');
      return res.redirect('/admin/admissions/intakes');
    }
  },
};
