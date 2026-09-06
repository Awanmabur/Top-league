const mongoose = require('mongoose');
const {
  MONTHS,
  buildPayrollFilters,
  calculatePayrollItem,
  closeRun,
  createPayrollRun,
  csvCell,
  deleteDraftRun,
  escapeRegex,
  markItemPaid,
  markRunPaid,
  processRun,
  approveRun,
  setItemHold,
  updateDraftItem,
  updateDraftRun,
} = require('../../../services/tenant/payrollService');

const actorUserId = (req) => req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
const str = (v) => String(v ?? '').trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const getDepartmentName = (dep) => dep?.name || dep?.title || dep?.code || '—';
const getStaffName = (staff) => staff?.fullName || [staff?.firstName, staff?.middleName, staff?.lastName].filter(Boolean).join(' ') || staff?.name || staff?.staffId || '—';

function serializeRun(doc, stats = null) {
  return {
    id: String(doc._id),
    runNumber: doc.runNumber || '',
    title: doc.title || '',
    periodLabel: doc.periodLabel || '',
    month: doc.month || '',
    year: Number(doc.year || 0),
    departmentId: doc.departmentId?._id ? String(doc.departmentId._id) : String(doc.departmentId || ''),
    departmentName: getDepartmentName(doc.departmentId),
    payDate: doc.payDate ? new Date(doc.payDate).toISOString().slice(0, 10) : '',
    status: doc.status || 'Draft',
    staffCount: Number(stats?.staffCount ?? doc.staffCount ?? 0),
    grossAmount: Number(stats?.grossAmount ?? doc.grossAmount ?? 0),
    deductionsAmount: Number(stats?.deductionsAmount ?? doc.deductionsAmount ?? 0),
    netAmount: Number(stats?.netAmount ?? doc.netAmount ?? 0),
    notes: doc.notes || '',
    processedAt: doc.processedAt ? new Date(doc.processedAt).toISOString() : '',
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : '',
    paidAt: doc.paidAt ? new Date(doc.paidAt).toISOString() : '',
    closedAt: doc.closedAt ? new Date(doc.closedAt).toISOString() : '',
  };
}

function serializeItem(doc) {
  return {
    id: String(doc._id),
    payrollRunId: doc.payrollRunId?._id ? String(doc.payrollRunId._id) : String(doc.payrollRunId || ''),
    runTitle: doc.payrollRunId?.title || '',
    runStatus: doc.payrollRunId?.status || '',
    staffId: doc.staffId?._id ? String(doc.staffId._id) : String(doc.staffId || ''),
    staffName: doc.staffName || getStaffName(doc.staffId),
    employeeId: doc.employeeId || doc.staffId?.employeeId || '',
    payrollNumber: doc.payrollNumber || doc.staffId?.payrollNumber || '',
    departmentName: doc.departmentName || getDepartmentName(doc.departmentId),
    basicSalary: Number(doc.basicSalary || 0),
    allowances: Number(doc.allowances || 0),
    bonuses: Number(doc.bonuses || 0),
    deductions: Number(doc.deductions || 0),
    grossPay: Number(doc.grossPay || 0),
    netPay: Number(doc.netPay || 0),
    status: doc.status || 'Pending',
    heldReason: doc.heldReason || '',
    paymentReference: doc.paymentReference || '',
    paidAt: doc.paidAt ? new Date(doc.paidAt).toISOString() : '',
    notes: doc.notes || '',
  };
}

function computeStats(items = []) {
  return items.reduce((acc, item) => {
    acc.staffCount += 1;
    acc.grossAmount += Number(item.grossPay || 0);
    acc.deductionsAmount += Number(item.deductions || 0);
    acc.netAmount += Number(item.netPay || 0);
    return acc;
  }, { staffCount: 0, grossAmount: 0, deductionsAmount: 0, netAmount: 0 });
}

function computeKpis(runs = []) {
  return {
    total: runs.length,
    draft: runs.filter((x) => x.status === 'Draft').length,
    processed: runs.filter((x) => x.status === 'Processed').length,
    approved: runs.filter((x) => x.status === 'Approved').length,
    closed: runs.filter((x) => x.status === 'Closed').length,
    netTotal: runs.reduce((sum, x) => sum + Number(x.netAmount || 0), 0),
  };
}

async function loadFiltered(req, { paginate = true, includeItems = true } = {}) {
  const { PayrollRun, PayrollItem, Department } = req.models;
  const clean = buildPayrollFilters(req.query);
  const runFilter = { isDeleted: { $ne: true } };
  if (clean.department !== 'all' && isValidId(clean.department)) runFilter.departmentId = clean.department;
  if (clean.status !== 'all') runFilter.status = clean.status;
  if (clean.year !== 'all' && /^\d{4}$/.test(String(clean.year))) runFilter.year = Number(clean.year);

  if (clean.q) {
    const rx = new RegExp(escapeRegex(clean.q), 'i');
    let departmentIds = [];
    if (Department) {
      departmentIds = await Department.find({
        $or: [{ name: rx }, { title: rx }, { code: rx }],
      }).select('_id').limit(100).lean().then((rows) => rows.map((row) => row._id)).catch(() => []);
    }
    runFilter.$or = [
      { runNumber: rx }, { title: rx }, { periodLabel: rx }, { month: rx }, { status: rx },
      ...(departmentIds.length ? [{ departmentId: { $in: departmentIds } }] : []),
    ];
  }

  const pageSize = 20;
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  let runQuery = PayrollRun.find(runFilter).populate('departmentId', 'name title code').sort({ year: -1, createdAt: -1 });
  if (paginate) runQuery = runQuery.skip((page - 1) * pageSize).limit(pageSize);

  const [runDocs, total, kpiRows, departments, years] = await Promise.all([
    runQuery.lean(),
    PayrollRun.countDocuments(runFilter),
    PayrollRun.aggregate([
      { $match: runFilter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        draft: { $sum: { $cond: [{ $eq: ['$status', 'Draft'] }, 1, 0] } },
        processed: { $sum: { $cond: [{ $eq: ['$status', 'Processed'] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
        closed: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } },
        netTotal: { $sum: { $ifNull: ['$netAmount', 0] } },
      } },
    ]).catch(() => []),
    Department ? Department.find({}).select('name title code').sort({ name: 1 }).limit(500).lean() : [],
    PayrollRun.distinct('year', { isDeleted: { $ne: true } }),
  ]);

  const runIds = runDocs.map((run) => run._id);
  const itemDocs = includeItems && runIds.length
    ? await PayrollItem.find({ payrollRunId: { $in: runIds }, isDeleted: { $ne: true } })
      .populate('staffId', 'firstName middleName lastName fullName employeeId payrollNumber')
      .populate('departmentId', 'name title code')
      .populate('payrollRunId', 'title status month year')
      .sort({ createdAt: -1 }).lean()
    : [];

  const itemsByRun = new Map();
  for (const item of itemDocs) {
    const id = String(item.payrollRunId?._id || item.payrollRunId || '');
    if (!itemsByRun.has(id)) itemsByRun.set(id, []);
    itemsByRun.get(id).push(item);
  }
  const runs = runDocs.map((run) => serializeRun(run, includeItems
    ? computeStats(itemsByRun.get(String(run._id)) || [])
    : { staffCount: run.staffCount, grossAmount: run.grossAmount, deductionsAmount: run.deductionsAmount, netAmount: run.netAmount }));
  let payrollItems = itemDocs.map(serializeItem);
  if (clean.q && includeItems) {
    const re = new RegExp(escapeRegex(clean.q), 'i');
    payrollItems = payrollItems.filter((item) => re.test([item.staffName, item.employeeId, item.payrollNumber, item.departmentName, item.status, item.notes].join(' ')));
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const makePageUrl = (target) => { const qs = new URLSearchParams(req.query || {}); qs.set('page', String(target)); return `/admin/payroll?${qs.toString()}`; };
  return {
    clean, runs, payrollItems, departments,
    years: years.map(String).filter(Boolean).sort().reverse(),
    kpis: kpiRows[0] || { total: 0, draft: 0, processed: 0, approved: 0, closed: 0, netTotal: 0 },
    pagination: paginate ? { page, pageSize, total, pageCount, prevUrl: page > 1 ? makePageUrl(page - 1) : '', nextUrl: page < pageCount ? makePageUrl(page + 1) : '' } : null,
  };
}

function redirectWith(req, res, type, message) {
  req.flash?.(type, message);
  return res.redirect('/admin/payroll');
}

async function action(req, res, fn, success) {
  if (!isValidId(req.params.id)) return redirectWith(req, res, 'error', 'Invalid payroll run ID.');
  try {
    await fn();
    return redirectWith(req, res, 'success', success);
  } catch (err) {
    return redirectWith(req, res, 'error', err?.message || 'Payroll action failed.');
  }
}

module.exports = {
  index: async (req, res) => {
    const data = await loadFiltered(req);
    return res.render('tenant/staff/payroll', {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      payrollRuns: data.runs,
      payrollItems: data.payrollItems,
      kpis: data.kpis,
      departments: data.departments.map((d) => ({ id: String(d._id), name: getDepartmentName(d) })),
      years: data.years,
      query: data.clean,
      months: MONTHS,
      pagination: data.pagination,
    });
  },

  createRun: async (req, res) => {
    try {
      await createPayrollRun(req.models, {
        title: req.body.title, month: req.body.month, year: req.body.year,
        periodLabel: req.body.periodLabel, departmentId: isValidId(req.body.departmentId) ? req.body.departmentId : null,
        payDate: safeDate(req.body.payDate), notes: req.body.notes,
      }, { actorUserId: actorUserId(req) });
      return redirectWith(req, res, 'success', 'Payroll run created from current eligible staff salary records.');
    } catch (err) { return redirectWith(req, res, 'error', err?.message || 'Could not create payroll run.'); }
  },

  updateRun: (req, res) => action(req, res, () => updateDraftRun(req.models, req.params.id, {
    title: req.body.title, periodLabel: req.body.periodLabel, payDate: safeDate(req.body.payDate), notes: req.body.notes,
  }, { actorUserId: actorUserId(req) }), 'Payroll run updated.'),

  processRun: (req, res) => action(req, res, () => processRun(req.models, req.params.id, { actorUserId: actorUserId(req) }), 'Payroll run processed.'),
  approveRun: (req, res) => action(req, res, () => approveRun(req.models, req.params.id, { actorUserId: actorUserId(req) }), 'Payroll run approved.'),
  payRun: (req, res) => action(req, res, () => markRunPaid(req.models, req.params.id, { paymentReference: req.body.paymentReference }, { actorUserId: actorUserId(req) }), 'Eligible payroll items marked paid.'),
  closeRun: (req, res) => action(req, res, () => closeRun(req.models, req.params.id, { actorUserId: actorUserId(req) }), 'Payroll run closed and salary expense recorded.'),
  deleteRun: (req, res) => action(req, res, () => deleteDraftRun(req.models, req.params.id, { actorUserId: actorUserId(req) }), 'Draft payroll run deleted.'),

  updateItem: async (req, res) => {
    if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return redirectWith(req, res, 'error', 'Invalid payroll item.');
    try {
      await updateDraftItem(req.models, req.params.id, req.params.itemId, req.body, { actorUserId: actorUserId(req) });
      return redirectWith(req, res, 'success', 'Payroll item adjusted.');
    } catch (err) { return redirectWith(req, res, 'error', err?.message || 'Could not adjust payroll item.'); }
  },

  holdItem: async (req, res) => {
    if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return redirectWith(req, res, 'error', 'Invalid payroll item.');
    try {
      await setItemHold(req.models, req.params.id, req.params.itemId, true, req.body.reason, { actorUserId: actorUserId(req) });
      return redirectWith(req, res, 'success', 'Payroll item placed on hold.');
    } catch (err) { return redirectWith(req, res, 'error', err?.message || 'Could not hold payroll item.'); }
  },

  releaseItem: async (req, res) => {
    if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return redirectWith(req, res, 'error', 'Invalid payroll item.');
    try {
      await setItemHold(req.models, req.params.id, req.params.itemId, false, '', { actorUserId: actorUserId(req) });
      return redirectWith(req, res, 'success', 'Payroll item released.');
    } catch (err) { return redirectWith(req, res, 'error', err?.message || 'Could not release payroll item.'); }
  },

  payItem: async (req, res) => {
    if (!isValidId(req.params.id) || !isValidId(req.params.itemId)) return redirectWith(req, res, 'error', 'Invalid payroll item.');
    try {
      await markItemPaid(req.models, req.params.id, req.params.itemId, req.body, { actorUserId: actorUserId(req) });
      return redirectWith(req, res, 'success', 'Payroll item marked paid.');
    } catch (err) { return redirectWith(req, res, 'error', err?.message || 'Could not mark payroll item paid.'); }
  },

  bulkAction: async (req, res) => {
    const ids = str(req.body.ids).split(',').map((x) => x.trim()).filter(isValidId);
    if (!ids.length) return redirectWith(req, res, 'error', 'No payroll runs selected.');
    const actionName = str(req.body.action);
    const handlers = {
      process: (id) => processRun(req.models, id, { actorUserId: actorUserId(req) }),
      approve: (id) => approveRun(req.models, id, { actorUserId: actorUserId(req) }),
      pay: (id) => markRunPaid(req.models, id, {}, { actorUserId: actorUserId(req) }),
      close: (id) => closeRun(req.models, id, { actorUserId: actorUserId(req) }),
      delete: (id) => deleteDraftRun(req.models, id, { actorUserId: actorUserId(req) }),
    };
    const handler = handlers[actionName];
    if (!handler) return redirectWith(req, res, 'error', 'Invalid payroll bulk action.');
    let changed = 0; const failures = [];
    for (const id of ids) {
      try { await handler(id); changed += 1; }
      catch (err) { failures.push(err?.message || id); }
    }
    if (failures.length) req.flash?.('error', `${failures.length} payroll run(s) were skipped because their lifecycle did not allow this action.`);
    req.flash?.('success', `${changed} payroll run(s) updated.`);
    return res.redirect('/admin/payroll');
  },

  exportCsv: async (req, res) => {
    const data = await loadFiltered(req, { paginate: false, includeItems: false });
    const lines = [[
      'Run Number','Title','Period','Department','Pay Date','Status','Staff','Gross','Deductions','Net','Created/Processed/Approved/Closed'
    ].map(csvCell).join(',')];
    for (const run of data.runs) {
      lines.push([
        run.runNumber, run.title, `${run.month} ${run.year}`, run.departmentName, run.payDate, run.status,
        run.staffCount, run.grossAmount, run.deductionsAmount, run.netAmount,
        [run.processedAt && `Processed ${run.processedAt}`, run.approvedAt && `Approved ${run.approvedAt}`, run.closedAt && `Closed ${run.closedAt}`].filter(Boolean).join(' | '),
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payroll-runs.csv"');
    return res.send(`\ufeff${lines.join('\n')}\n`);
  },
};
