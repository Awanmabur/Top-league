const crypto = require('crypto');
const { generateExpenseNumber } = require('./expenseService');
const { assertActiveDepartment } = require('./organizationCatalogService');

const MONTHS = Object.freeze([
  'January','February','March','April','May','June','July','August','September','October','November','December',
]);
const RUN_STATUSES = Object.freeze(['Draft','Processed','Approved','Closed']);
const ITEM_STATUSES = Object.freeze(['Pending','Processed','Paid','Held']);
const MAX_MONEY = 1_000_000_000_000_000;

const str = (value, max = 3000) => String(value ?? '').trim().slice(0, max);
const idString = (value) => String(value?._id || value || '');

function normalizeMonth(value) {
  const clean = str(value, 20).toLowerCase();
  return MONTHS.find((m) => m.toLowerCase() === clean) || null;
}

function normalizeYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 2000 && n <= 3000 ? n : null;
}

function money(value, label = 'Amount') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) throw new Error(`${label} is invalid.`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calculatePayrollItem(input = {}) {
  const basicSalary = money(input.basicSalary, 'Basic salary');
  const allowances = money(input.allowances, 'Allowances');
  const bonuses = money(input.bonuses, 'Bonuses');
  const deductions = money(input.deductions, 'Deductions');
  const grossPay = money(basicSalary + allowances + bonuses, 'Gross pay');
  if (deductions > grossPay) throw new Error('Deductions cannot exceed gross pay.');
  const netPay = money(grossPay - deductions, 'Net pay');
  return { basicSalary, allowances, bonuses, deductions, grossPay, netPay };
}

function monthNumber(month) {
  const idx = MONTHS.indexOf(normalizeMonth(month));
  return idx < 0 ? 0 : idx + 1;
}

function payrollScopeKey(year, month, departmentId = null) {
  const y = normalizeYear(year);
  const m = normalizeMonth(month);
  if (!y || !m) throw new Error('A valid payroll month and year are required.');
  return `${y}-${String(monthNumber(m)).padStart(2, '0')}:${departmentId ? idString(departmentId) : 'ALL'}`;
}

function runNumberCandidate(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid payroll run number date.');
  return `PAY-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

async function allocateRunNumber(PayrollRun, now = new Date(), attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const runNumber = runNumberCandidate(now);
    if (!(await PayrollRun.exists({ runNumber }))) return runNumber;
  }
  throw new Error('Could not allocate a unique payroll run number.');
}

function escapeRegex(value) {
  return str(value, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function csvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function getStaffName(staff = {}) {
  return str(staff.fullName || [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(' ') || staff.name || staff.employeeId || '—', 220);
}

function eligibleStaffFilter(departmentId = null) {
  const filter = { isDeleted: { $ne: true }, status: { $in: ['Active', 'On Leave'] } };
  if (departmentId) filter.departmentId = departmentId;
  return filter;
}

function runTransitionAllowed(from, to) {
  return (from === 'Draft' && to === 'Processed') ||
    (from === 'Processed' && to === 'Approved') ||
    (from === 'Approved' && to === 'Closed');
}

function lockUntil(now = new Date()) { return new Date(now.getTime() + 30_000); }

async function acquireRunLock(models, runId, now = new Date()) {
  const token = crypto.randomUUID();
  const run = await models.PayrollRun.findOneAndUpdate(
    {
      _id: runId,
      isDeleted: { $ne: true },
      $or: [
        { 'ops.lockUntil': { $exists: false } },
        { 'ops.lockUntil': null },
        { 'ops.lockUntil': { $lte: now } },
      ],
    },
    { $set: { 'ops.lockToken': token, 'ops.lockUntil': lockUntil(now) } },
    { new: true }
  );
  if (!run) throw new Error('Payroll run is busy. Please retry.');
  return { token, run };
}

async function releaseRunLock(models, runId, token) {
  if (!models?.PayrollRun || !runId || !token) return;
  await models.PayrollRun.updateOne(
    { _id: runId, 'ops.lockToken': token },
    { $set: { 'ops.lockToken': null, 'ops.lockUntil': null } }
  ).catch(() => null);
}

async function withRunLock(models, runId, fn) {
  const { token, run } = await acquireRunLock(models, runId);
  try { return await fn(run); }
  finally { await releaseRunLock(models, runId, token); }
}

async function recomputeRun(models, runId, actorUserId = null) {
  const items = await models.PayrollItem.find({ payrollRunId: runId, isDeleted: { $ne: true } }).lean();
  const stats = items.reduce((acc, item) => {
    acc.staffCount += 1;
    acc.grossAmount += Number(item.grossPay || 0);
    acc.deductionsAmount += Number(item.deductions || 0);
    acc.netAmount += Number(item.netPay || 0);
    return acc;
  }, { staffCount: 0, grossAmount: 0, deductionsAmount: 0, netAmount: 0 });
  await models.PayrollRun.updateOne({ _id: runId }, { $set: { ...stats, updatedBy: actorUserId || null } });
  return stats;
}

async function createPayrollRun(models, input = {}, context = {}) {
  if (!models?.PayrollRun || !models?.PayrollItem || !models?.Staff) throw new Error('Payroll models are unavailable.');
  const month = normalizeMonth(input.month);
  const year = normalizeYear(input.year);
  const title = str(input.title, 180);
  const requestedDepartmentId = input.departmentId ? idString(input.departmentId) : null;
  if (!title || !month || !year) throw new Error('Title, month and year are required.');
  const departmentId = requestedDepartmentId ? idString(await assertActiveDepartment(models.Department, requestedDepartmentId)) : null;
  const scopeKey = payrollScopeKey(year, month, departmentId);
  if (await models.PayrollRun.exists({ scopeKey, isDeleted: { $ne: true } })) throw new Error('A payroll run already exists for this period and scope.');
  const runNumber = await allocateRunNumber(models.PayrollRun);
  let run;
  try {
    run = await models.PayrollRun.create({
      runNumber, scopeKey, title, month, year,
      periodLabel: str(input.periodLabel || `${month} ${year}`, 120),
      departmentId: departmentId || null,
      payDate: input.payDate || null,
      status: 'Draft', notes: str(input.notes, 3000),
      createdBy: context.actorUserId || null, updatedBy: context.actorUserId || null,
    });
  } catch (err) {
    if (err?.code === 11000) throw new Error('A payroll run already exists for this period and scope.');
    throw err;
  }

  try {
    const staffList = await models.Staff.find(eligibleStaffFilter(departmentId)).populate('departmentId', 'name title code').lean();
    const docs = staffList.map((staff) => {
      const values = calculatePayrollItem({ basicSalary: staff.salary || 0, allowances: 0, bonuses: 0, deductions: 0 });
      return {
        payrollRunId: run._id,
        staffId: staff._id,
        departmentId: staff.departmentId?._id || staff.departmentId || null,
        staffName: getStaffName(staff),
        employeeId: str(staff.employeeId, 120),
        payrollNumber: str(staff.payrollNumber, 120),
        departmentName: str(staff.departmentId?.name || staff.departmentId?.title || staff.departmentId?.code, 180),
        ...values,
        status: 'Pending',
        createdBy: context.actorUserId || null, updatedBy: context.actorUserId || null,
      };
    });
    if (docs.length) await models.PayrollItem.insertMany(docs, { ordered: true });
    await recomputeRun(models, run._id, context.actorUserId);
    return run;
  } catch (err) {
    await models.PayrollItem.deleteMany({ payrollRunId: run._id }).catch(() => null);
    await models.PayrollRun.deleteOne({ _id: run._id }).catch(() => null);
    throw err;
  }
}

async function updateDraftRun(models, runId, input = {}, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (run.status !== 'Draft') throw new Error('Only Draft payroll runs can be edited.');
    const title = str(input.title, 180);
    if (!title) throw new Error('Payroll title is required.');
    run.title = title;
    run.periodLabel = str(input.periodLabel || `${run.month} ${run.year}`, 120);
    run.payDate = input.payDate || null;
    run.notes = str(input.notes, 3000);
    run.updatedBy = context.actorUserId || null;
    await run.save();
    return run;
  });
}

async function updateDraftItem(models, runId, itemId, input = {}, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (run.status !== 'Draft') throw new Error('Payroll items can only be adjusted while the run is Draft.');
    const item = await models.PayrollItem.findOne({ _id: itemId, payrollRunId: runId, isDeleted: { $ne: true } });
    if (!item) throw new Error('Payroll item not found.');
    const values = calculatePayrollItem({
      basicSalary: item.basicSalary,
      allowances: input.allowances,
      bonuses: input.bonuses,
      deductions: input.deductions,
    });
    Object.assign(item, values, { notes: str(input.notes, 2000), updatedBy: context.actorUserId || null });
    await item.save();
    await recomputeRun(models, runId, context.actorUserId);
    return item;
  });
}

async function processRun(models, runId, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (!runTransitionAllowed(run.status, 'Processed')) throw new Error('Only a Draft payroll run can be processed.');
    const count = await models.PayrollItem.countDocuments({ payrollRunId: runId, isDeleted: { $ne: true } });
    if (!count) throw new Error('Payroll run has no staff items to process.');
    await recomputeRun(models, runId, context.actorUserId);
    await models.PayrollItem.updateMany(
      { payrollRunId: runId, isDeleted: { $ne: true }, status: 'Pending' },
      { $set: { status: 'Processed', processedAt: new Date(), updatedBy: context.actorUserId || null } }
    );
    run.status = 'Processed'; run.processedAt = new Date(); run.processedBy = context.actorUserId || null; run.updatedBy = context.actorUserId || null;
    await run.save();
    return run;
  });
}

async function approveRun(models, runId, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (!runTransitionAllowed(run.status, 'Approved')) throw new Error('Only a Processed payroll run can be approved.');
    run.status = 'Approved'; run.approvedAt = new Date(); run.approvedBy = context.actorUserId || null; run.updatedBy = context.actorUserId || null;
    await run.save();
    return run;
  });
}

async function setItemHold(models, runId, itemId, hold, reason = '', context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (!['Processed','Approved'].includes(run.status)) throw new Error('Payroll items can only be held after processing and before closure.');
    const item = await models.PayrollItem.findOne({ _id: itemId, payrollRunId: runId, isDeleted: { $ne: true } });
    if (!item) throw new Error('Payroll item not found.');
    if (item.status === 'Paid') throw new Error('A paid payroll item cannot be held.');
    if (hold) {
      item.status = 'Held'; item.heldAt = new Date(); item.heldReason = str(reason, 1000) || 'Payment held';
    } else {
      if (item.status !== 'Held') throw new Error('Only a held payroll item can be released.');
      item.status = 'Processed'; item.heldAt = null; item.heldReason = '';
    }
    item.updatedBy = context.actorUserId || null;
    await item.save();
    return item;
  });
}

async function markItemPaid(models, runId, itemId, input = {}, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (run.status !== 'Approved') throw new Error('Payroll can only be paid after approval.');
    const item = await models.PayrollItem.findOne({ _id: itemId, payrollRunId: runId, isDeleted: { $ne: true } });
    if (!item) throw new Error('Payroll item not found.');
    if (item.status !== 'Processed') throw new Error('Only a processed payroll item can be marked paid.');
    item.status = 'Paid'; item.paidAt = new Date(); item.paidBy = context.actorUserId || null;
    item.paymentReference = str(input.paymentReference, 180); item.updatedBy = context.actorUserId || null;
    await item.save();
    return item;
  });
}

async function markRunPaid(models, runId, input = {}, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (run.status !== 'Approved') throw new Error('Only an Approved payroll run can be marked paid.');
    const now = new Date();
    await models.PayrollItem.updateMany(
      { payrollRunId: runId, isDeleted: { $ne: true }, status: 'Processed' },
      { $set: { status: 'Paid', paidAt: now, paidBy: context.actorUserId || null, paymentReference: str(input.paymentReference, 180), updatedBy: context.actorUserId || null } }
    );
    run.paidAt = now; run.paidBy = context.actorUserId || null; run.updatedBy = context.actorUserId || null;
    await run.save();
    return run;
  });
}

async function ensurePayrollExpense(models, run, context = {}) {
  if (!models?.Expense) throw new Error('Expense model is required before payroll can be closed.');
  if (run.expenseId) return run.expenseId;
  const items = await models.PayrollItem.find({ payrollRunId: run._id, isDeleted: { $ne: true }, status: 'Paid' }).lean();
  const amount = items.reduce((sum, item) => sum + Number(item.netPay || 0), 0);
  if (amount <= 0) return null;
  const expenseNumber = await generateExpenseNumber(models.Expense);
  const expense = await models.Expense.create({
    expenseNumber,
    reference: run.runNumber || idString(run._id),
    title: `Payroll — ${run.periodLabel || `${run.month} ${run.year}`}`,
    description: `Salary payroll settlement for ${run.staffCount || items.length} staff member(s).`,
    category: 'Salary', amount, expenseDate: run.payDate || new Date(), paidTo: 'Staff payroll', method: 'Transfer', status: 'Approved',
    notes: `Generated automatically from payroll run ${run.runNumber || idString(run._id)}.`,
    approvedAt: new Date(), approvedBy: context.actorUserId || null,
    createdBy: context.actorUserId || null, updatedBy: context.actorUserId || null,
  });
  await models.PayrollRun.updateOne({ _id: run._id, expenseId: null }, { $set: { expenseId: expense._id } });
  return expense._id;
}

async function closeRun(models, runId, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (!runTransitionAllowed(run.status, 'Closed')) throw new Error('Only an Approved payroll run can be closed.');
    const unpaid = await models.PayrollItem.countDocuments({ payrollRunId: runId, isDeleted: { $ne: true }, status: { $ne: 'Paid' } });
    if (unpaid) throw new Error('All payroll items must be paid before the run can be closed.');
    await recomputeRun(models, runId, context.actorUserId);
    await ensurePayrollExpense(models, run, context);
    run.status = 'Closed'; run.closedAt = new Date(); run.closedBy = context.actorUserId || null; run.updatedBy = context.actorUserId || null;
    await run.save();
    return run;
  });
}

async function deleteDraftRun(models, runId, context = {}) {
  return withRunLock(models, runId, async (run) => {
    if (run.status !== 'Draft') throw new Error('Only Draft payroll runs can be deleted.');
    const now = new Date();
    await models.PayrollItem.updateMany({ payrollRunId: runId, isDeleted: { $ne: true } }, { $set: { isDeleted: true, deletedAt: now, updatedBy: context.actorUserId || null } });
    run.isDeleted = true; run.deletedAt = now; run.updatedBy = context.actorUserId || null; await run.save();
    return run;
  });
}

function buildPayrollFilters(query = {}) {
  const q = str(query.q, 200);
  const status = RUN_STATUSES.includes(str(query.status)) ? str(query.status) : 'all';
  const department = str(query.department, 80) || 'all';
  const year = normalizeYear(query.year) ? String(normalizeYear(query.year)) : 'all';
  const view = ['list','items','summary'].includes(str(query.view)) ? str(query.view) : 'list';
  return { q, status, department, year, view };
}

module.exports = {
  MONTHS, RUN_STATUSES, ITEM_STATUSES,
  normalizeMonth, normalizeYear, money, calculatePayrollItem, monthNumber, payrollScopeKey,
  runNumberCandidate, allocateRunNumber, escapeRegex, csvCell, getStaffName, eligibleStaffFilter,
  runTransitionAllowed, acquireRunLock, releaseRunLock, withRunLock, recomputeRun,
  createPayrollRun, updateDraftRun, updateDraftItem, processRun, approveRun, setItemHold,
  markItemPaid, markRunPaid, closeRun, deleteDraftRun, buildPayrollFilters, ensurePayrollExpense,
};
