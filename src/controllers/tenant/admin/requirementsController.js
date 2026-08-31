const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const {
  REQUIREMENT_CATEGORIES,
  bool,
  normalizeRequirementScope,
  objectIdString,
  parseCsvBuffer,
  positiveRevision,
  str,
} = require('../../../services/tenant/admissionsOperationsService');

function normalizeCode(value) {
  return str(value, 80)
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 40);
}

async function buildRequirementCode(AdmissionRequirement, title, excludeId = null) {
  const stem = normalizeCode(title).replace(/-/g, '').slice(0, 5) || 'REQ';
  for (let n = 1; n < 10000; n += 1) {
    const code = `${stem}${String(n).padStart(2, '0')}`;
    const query = { code, isDeleted: { $ne: true } };
    if (excludeId) query._id = { $ne: excludeId };
    const exists = await AdmissionRequirement.findOne(query).select('_id').lean();
    if (!exists) return code;
  }
  throw new Error('Unable to allocate a unique requirement code.');
}

function validCategory(value) {
  const category = str(value, 20).toLowerCase();
  return REQUIREMENT_CATEGORIES.includes(category) ? category : 'document';
}

function validCurrency(value) {
  const currency = str(value, 10).toUpperCase();
  return /^[A-Z]{3,10}$/.test(currency) ? currency : 'UGX';
}

function finiteNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

async function assertScopeReferences(models, scope) {
  const { Section, Intake } = models || {};
  if (!Section || !Intake) throw new Error('Admission requirement scope models are unavailable.');
  if (scope.programs.length) {
    const count = await Section.countDocuments({ _id: { $in: scope.programs }, status: { $ne: 'archived' } });
    if (count !== scope.programs.length) throw new Error('One or more selected Sections are unavailable or archived.');
  }
  if (scope.intakes.length) {
    const count = await Intake.countDocuments({ _id: { $in: scope.intakes }, isDeleted: { $ne: true } });
    if (count !== scope.intakes.length) throw new Error('One or more selected Intakes are unavailable.');
  }
}

function requirementPatch(body, current = null) {
  const title = str(body.title, 120);
  if (title.length < 3) throw new Error('Title is required (3-120 chars).');
  const category = validCategory(body.category || current?.category || 'document');
  const description = str(body.description, 700);
  const feeAmount = category === 'fee' ? finiteNumber(body.feeAmount, 0, 0, 1_000_000_000) : 0;
  if (category === 'fee' && !Number.isFinite(Number(body.feeAmount ?? 0))) throw new Error('Fee amount must be a valid number.');
  const currency = validCurrency(body.currency || current?.currency || 'UGX');
  const sortOrder = Math.trunc(finiteNumber(body.sortOrder, current?.sortOrder || 0, 0, 99999));
  const scope = normalizeRequirementScope({
    appliesToAllPrograms: body.appliesToAllPrograms,
    programs: body.programs,
    appliesToAllIntakes: body.appliesToAllIntakes,
    intakes: body.intakes,
  });
  return {
    title,
    category,
    description,
    feeAmount,
    currency,
    sortOrder,
    ...scope,
    isMandatory: bool(body.isMandatory, current ? current.isMandatory !== false : true),
    isActive: bool(body.isActive, current ? current.isActive !== false : true),
  };
}

function splitRefs(value) {
  return [...new Set(str(value, 5000).split(/[|;]+/).map((x) => str(x, 160)).filter(Boolean))];
}

async function makeResolver(Model, fields) {
  const rows = await Model.find({ isDeleted: { $ne: true } }).lean();
  const map = new Map();
  for (const row of rows) {
    map.set(String(row._id).toLowerCase(), String(row._id));
    for (const field of fields) {
      const value = str(row[field], 160).toLowerCase();
      if (value && !map.has(value)) map.set(value, String(row._id));
    }
  }
  return (value) => map.get(str(value, 160).toLowerCase()) || null;
}

const requirementRules = [
  body('title').trim().isLength({ min: 3, max: 120 }).withMessage('Title is required (3-120 chars).'),
  body('code').optional({ checkFalsy: true }).trim().isLength({ max: 40 }).customSanitizer((v) => normalizeCode(v)),
  body('category').optional({ checkFalsy: true }).custom((v) => REQUIREMENT_CATEGORIES.includes(String(v))).withMessage('Invalid category.'),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 700 }).withMessage('Description is too long.'),
  body('currency').optional({ checkFalsy: true }).trim().matches(/^[A-Za-z]{3,10}$/).withMessage('Currency must be 3-10 letters.'),
  body('sortOrder').optional({ checkFalsy: true }).isInt({ min: 0, max: 99999 }).toInt(),
];

module.exports = {
  requirementRules,

  index: async (req, res) => {
    try {
      const { AdmissionRequirement, Section, Intake } = req.models || {};
      if (!AdmissionRequirement || !Section || !Intake) throw new Error('Admission requirement models are not fully loaded.');
      const q = str(req.query.q, 120);
      const category = str(req.query.category, 20);
      const isActive = str(req.query.isActive, 10);
      const program = str(req.query.section || req.query.program, 40);
      const intake = str(req.query.intake, 40);
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const perPage = 10;
      const filter = { isDeleted: { $ne: true } };
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ title: rx }, { code: rx }, { category: rx }];
      }
      if (REQUIREMENT_CATEGORIES.includes(category)) filter.category = category;
      if (isActive === 'true' || isActive === 'false') filter.isActive = isActive === 'true';
      if (objectIdString(program)) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: [{ appliesToAllPrograms: true }, { programs: objectIdString(program) }] });
      }
      if (objectIdString(intake)) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: [{ appliesToAllIntakes: true }, { intakes: objectIdString(intake) }] });
      }
      const total = await AdmissionRequirement.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);
      const [items, programs, intakes, counts] = await Promise.all([
        AdmissionRequirement.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip((safePage - 1) * perPage).limit(perPage).lean(),
        Section.find({ status: { $ne: 'archived' } }).select('code name classLevel classStream').sort({ classLevel: 1, classStream: 1, name: 1 }).lean(),
        Intake.find({ isDeleted: { $ne: true } }).select('name code term isActive status').sort({ isActive: -1, createdAt: -1 }).lean(),
        AdmissionRequirement.aggregate([
          { $match: filter },
          { $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
            mandatory: { $sum: { $cond: [{ $eq: ['$isMandatory', true] }, 1, 0] } },
            document: { $sum: { $cond: [{ $eq: ['$category', 'document'] }, 1, 0] } },
            fee: { $sum: { $cond: [{ $eq: ['$category', 'fee'] }, 1, 0] } },
            exam: { $sum: { $cond: [{ $eq: ['$category', 'exam'] }, 1, 0] } },
            medical: { $sum: { $cond: [{ $eq: ['$category', 'medical'] }, 1, 0] } },
            other: { $sum: { $cond: [{ $eq: ['$category', 'other'] }, 1, 0] } },
          } },
        ]),
      ]);
      return res.render('tenant/requirements/index', {
        tenant: req.tenant || null,
        items,
        programs,
        intakes,
        csrfToken: res.locals.csrfToken || (typeof req.csrfToken === 'function' ? req.csrfToken() : ''),
        counts: counts[0] || { total: 0, active: 0, mandatory: 0, document: 0, fee: 0, exam: 0, medical: 0, other: 0 },
        query: { q, category, isActive, section: program, program, intake, page: safePage, total, totalPages, perPage },
        messages: { success: req.flash ? req.flash('success') : [], error: req.flash ? req.flash('error') : [] },
      });
    } catch (err) {
      console.error('[REQ:index]', err);
      return res.status(500).send('Failed to load requirements.');
    }
  },

  create: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.('error', errors.array().map((e) => e.msg).join(' '));
      return res.redirect('/admin/admissions/requirements');
    }
    try {
      const { AdmissionRequirement } = req.models || {};
      const patch = requirementPatch(req.body);
      await assertScopeReferences(req.models, patch);
      const code = await buildRequirementCode(AdmissionRequirement, patch.title);
      await AdmissionRequirement.create({ ...patch, code, revision: 1, createdBy: req.user?._id || null, updatedBy: req.user?._id || null });
      req.flash?.('success', 'Requirement created.');
    } catch (err) {
      console.error('[REQ:create]', err);
      req.flash?.('error', String(err?.code) === '11000' ? 'Requirement code already exists.' : (err.message || 'Failed to create requirement.'));
    }
    return res.redirect('/admin/admissions/requirements');
  },

  update: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.('error', errors.array().map((e) => e.msg).join(' '));
      return res.redirect('/admin/admissions/requirements');
    }
    try {
      const { AdmissionRequirement } = req.models || {};
      const id = objectIdString(req.params.id);
      const revision = positiveRevision(req.body.revision);
      if (!id || !revision) throw new Error('A current requirement revision is required. Reload and try again.');
      const current = await AdmissionRequirement.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!current) throw new Error('Requirement not found.');
      const patch = requirementPatch(req.body, current);
      await assertScopeReferences(req.models, patch);
      patch.code = current.code || await buildRequirementCode(AdmissionRequirement, patch.title, id);
      patch.updatedBy = req.user?._id || null;
      const result = await AdmissionRequirement.updateOne({ _id: id, revision, isDeleted: { $ne: true } }, { $set: patch, $inc: { revision: 1 } });
      if (result.modifiedCount !== 1) throw new Error('This requirement changed concurrently. Reload and try again.');
      req.flash?.('success', 'Requirement updated.');
    } catch (err) {
      console.error('[REQ:update]', err);
      req.flash?.('error', String(err?.code) === '11000' ? 'Requirement code already exists.' : (err.message || 'Failed to update requirement.'));
    }
    return res.redirect('/admin/admissions/requirements');
  },

  remove: async (req, res) => {
    try {
      const { AdmissionRequirement } = req.models || {};
      const id = objectIdString(req.params.id);
      const revision = positiveRevision(req.body.revision);
      if (!id || !revision) throw new Error('A current requirement revision is required. Reload and try again.');
      const result = await AdmissionRequirement.updateOne(
        { _id: id, revision, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
      );
      if (result.modifiedCount !== 1) throw new Error('This requirement changed concurrently or no longer exists. Reload and try again.');
      req.flash?.('success', 'Requirement deleted. Existing applicant snapshots remain unchanged.');
    } catch (err) {
      console.error('[REQ:remove]', err);
      req.flash?.('error', err.message || 'Failed to delete requirement.');
    }
    return res.redirect('/admin/admissions/requirements');
  },

  importCsv: async (req, res) => {
    const createdIds = [];
    try {
      const { AdmissionRequirement, Section, Intake } = req.models || {};
      if (!req.file?.buffer) throw new Error('Please choose a CSV file.');
      const { rows } = parseCsvBuffer(req.file.buffer, { maxBytes: 1024 * 1024, maxRows: 1000 });
      const resolveSection = await makeResolver(Section, ['code', 'name']);
      const resolveIntake = await makeResolver(Intake, ['code', 'name', 'term']);
      const seenCodes = new Set();
      const prepared = [];
      for (const [index, row] of rows.entries()) {
        const title = str(row.title, 120);
        if (title.length < 3) throw new Error(`CSV row ${index + 2} requires a title.`);
        const code = normalizeCode(row.code) || await buildRequirementCode(AdmissionRequirement, title);
        if (seenCodes.has(code)) throw new Error(`CSV contains duplicate requirement code ${code}.`);
        seenCodes.add(code);
        const category = validCategory(row.category || 'document');
        const allPrograms = bool(row.appliestoallsections ?? row.appliestoallprograms, true);
        const allIntakes = bool(row.appliestoallintakes, true);
        const programs = allPrograms ? [] : splitRefs(row.sections ?? row.programs).map(resolveSection).filter(Boolean);
        const intakes = allIntakes ? [] : splitRefs(row.intakes).map(resolveIntake).filter(Boolean);
        const scope = normalizeRequirementScope({ appliesToAllPrograms: allPrograms, programs, appliesToAllIntakes: allIntakes, intakes });
        const item = {
          title,
          code,
          category,
          description: str(row.description, 700),
          feeAmount: category === 'fee' ? finiteNumber(row.feeamount, 0, 0, 1_000_000_000) : 0,
          currency: validCurrency(row.currency || 'UGX'),
          sortOrder: Math.trunc(finiteNumber(row.sortorder, 0, 0, 99999)),
          ...scope,
          isMandatory: bool(row.ismandatory, true),
          isActive: bool(row.isactive, true),
          revision: 1,
          createdBy: req.user?._id || null,
          updatedBy: req.user?._id || null,
        };
        await assertScopeReferences(req.models, item);
        prepared.push(item);
      }
      const existing = await AdmissionRequirement.find({ code: { $in: [...seenCodes] }, isDeleted: { $ne: true } }).select('code').lean();
      if (existing.length) throw new Error(`Requirement code already exists: ${existing.map((x) => x.code).join(', ')}.`);
      for (const item of prepared) {
        const created = await AdmissionRequirement.create(item);
        createdIds.push(created._id);
      }
      req.flash?.('success', `Import completed. Added ${createdIds.length} requirement(s).`);
    } catch (err) {
      if (createdIds.length) {
        try { await req.models.AdmissionRequirement.deleteMany({ _id: { $in: createdIds } }); } catch (_) {}
      }
      console.error('[REQ:importCsv]', err);
      req.flash?.('error', err.message || 'Failed to import requirements.');
    }
    return res.redirect('/admin/admissions/requirements');
  },

  bulkAction: async (req, res) => {
    const applied = [];
    try {
      const { AdmissionRequirement } = req.models || {};
      const action = str(req.body.action, 20);
      if (!['activate', 'deactivate', 'delete'].includes(action)) throw new Error('Invalid bulk action.');
      let requested = [];
      try { requested = JSON.parse(String(req.body.items || '[]')); } catch (_) {}
      if (!Array.isArray(requested) || !requested.length) throw new Error('No requirements selected. Reload and try again.');
      const normalized = requested.map((row) => ({ id: objectIdString(row?.id), revision: positiveRevision(row?.revision) }));
      if (normalized.some((row) => !row.id || !row.revision)) throw new Error('One or more requirement revisions are invalid. Reload and try again.');
      const docs = await AdmissionRequirement.find({ _id: { $in: normalized.map((x) => x.id) }, isDeleted: { $ne: true } }).lean();
      if (docs.length !== normalized.length) throw new Error('One or more selected requirements no longer exist. Reload and try again.');
      const byId = new Map(docs.map((row) => [String(row._id), row]));
      for (const row of normalized) {
        const doc = byId.get(row.id);
        if (Number(doc.revision || 1) !== row.revision) throw new Error(`Requirement ${doc.code || doc.title} changed concurrently. Reload and try again.`);
      }
      for (const row of normalized) {
        const doc = byId.get(row.id);
        const set = { updatedBy: req.user?._id || null };
        if (action === 'activate') set.isActive = true;
        if (action === 'deactivate') set.isActive = false;
        if (action === 'delete') Object.assign(set, { isActive: false, isDeleted: true, deletedAt: new Date() });
        const result = await AdmissionRequirement.updateOne({ _id: row.id, revision: row.revision, isDeleted: { $ne: true } }, { $set: set, $inc: { revision: 1 } });
        if (result.modifiedCount !== 1) throw new Error(`Requirement ${doc.code || doc.title} changed concurrently.`);
        applied.push({ id: row.id, before: doc });
      }
      req.flash?.('success', `Selected requirements ${action === 'delete' ? 'deleted' : action === 'activate' ? 'activated' : 'deactivated'}.`);
    } catch (err) {
      for (const row of applied.reverse()) {
        try {
          await req.models.AdmissionRequirement.updateOne(
            { _id: row.id, revision: Number(row.before.revision || 1) + 1 },
            { $set: { isActive: row.before.isActive !== false, isDeleted: row.before.isDeleted === true, deletedAt: row.before.deletedAt || null }, $inc: { revision: 1 } },
          );
        } catch (_) {}
      }
      console.error('[REQ:bulkAction]', err);
      req.flash?.('error', err.message || 'Bulk action failed.');
    }
    return res.redirect('/admin/admissions/requirements');
  },
};
