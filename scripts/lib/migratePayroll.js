const {
  MONTHS,
  calculatePayrollItem,
  payrollScopeKey,
  runNumberCandidate,
  getStaffName,
} = require('../../src/services/tenant/payrollService');

function canonicalRunStatus(value) {
  const clean = String(value || '').trim().toLowerCase();
  return ({ draft:'Draft', pending:'Draft', processed:'Processed', approved:'Approved', paid:'Approved', closed:'Closed' })[clean] || 'Draft';
}
function canonicalItemStatus(value) {
  const clean = String(value || '').trim().toLowerCase();
  return ({ pending:'Pending', processed:'Processed', approved:'Processed', paid:'Paid', held:'Held', hold:'Held' })[clean] || 'Pending';
}

async function migratePayroll(models = {}) {
  const { PayrollRun, PayrollItem, Staff } = models;
  if (!PayrollRun || !PayrollItem) return { runs: 0, items: 0, repairedRunNumbers: 0, duplicateScopes: 0, duplicateItems: 0, downgradedClosedRuns: 0 };
  const runs = await PayrollRun.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const usedNumbers = new Set();
  const usedScopes = new Set();
  let repairedRunNumbers = 0, duplicateScopes = 0;

  for (const row of runs) {
    const patch = {};
    let runNumber = String(row.runNumber || '').trim();
    if (!runNumber || usedNumbers.has(runNumber)) {
      do { runNumber = runNumberCandidate(row.createdAt || new Date()); } while (usedNumbers.has(runNumber));
      patch.runNumber = runNumber; repairedRunNumbers += 1;
    }
    usedNumbers.add(runNumber);

    const month = MONTHS.find((m) => m.toLowerCase() === String(row.month || '').trim().toLowerCase()) || 'January';
    const year = Number.isInteger(Number(row.year)) && Number(row.year) >= 2000 && Number(row.year) <= 3000 ? Number(row.year) : new Date(row.createdAt || Date.now()).getUTCFullYear();
    if (row.month !== month) patch.month = month;
    if (row.year !== year) patch.year = year;
    const status = canonicalRunStatus(row.status);
    if (row.status !== status) patch.status = status;

    const baseScope = payrollScopeKey(year, month, row.departmentId || null);
    let scopeKey = String(row.scopeKey || '').trim();
    if (!scopeKey || usedScopes.has(scopeKey) || (!scopeKey.startsWith(baseScope))) {
      scopeKey = usedScopes.has(baseScope) ? `${baseScope}:LEGACY:${String(row._id)}` : baseScope;
      if (scopeKey !== baseScope) duplicateScopes += 1;
      patch.scopeKey = scopeKey;
    }
    usedScopes.add(scopeKey);

    const stamp = row.updatedAt || row.createdAt || new Date();
    if (['Processed','Approved','Closed'].includes(status) && !row.processedAt) patch.processedAt = stamp;
    if (['Approved','Closed'].includes(status) && !row.approvedAt) patch.approvedAt = stamp;
    if (status === 'Closed' && !row.closedAt) patch.closedAt = stamp;
    if (Object.keys(patch).length) await PayrollRun.collection.updateOne({ _id: row._id }, { $set: patch });
  }

  const items = await PayrollItem.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const seenActive = new Set();
  let duplicateItems = 0;
  for (const row of items) {
    const patch = {};
    const runId = String(row.payrollRunId || '');
    const staffId = String(row.staffId || '');
    const key = `${runId}:${staffId}`;
    if (row.isDeleted !== true) {
      if (seenActive.has(key)) {
        patch.isDeleted = true; patch.deletedAt = row.updatedAt || new Date(); duplicateItems += 1;
      } else seenActive.add(key);
    }
    const run = runs.find((r) => String(r._id) === runId);
    let status = canonicalItemStatus(row.status);
    const runStatus = canonicalRunStatus(run?.status);
    if (status === 'Pending' && ['Processed','Approved','Closed'].includes(runStatus)) status = 'Processed';
    if (row.status !== status) patch.status = status;
    if (status === 'Processed' && !row.processedAt) patch.processedAt = row.updatedAt || row.createdAt || new Date();
    if (status === 'Paid' && !row.paidAt) patch.paidAt = row.updatedAt || row.createdAt || new Date();

    const staff = Staff && row.staffId ? await Staff.findById(row.staffId).populate('departmentId', 'name title code').lean().catch(() => null) : null;
    if (!row.staffName && staff) patch.staffName = getStaffName(staff);
    if (!row.employeeId && staff?.employeeId) patch.employeeId = String(staff.employeeId).slice(0,120);
    if (!row.payrollNumber && staff?.payrollNumber) patch.payrollNumber = String(staff.payrollNumber).slice(0,120);
    if (!row.departmentName && staff?.departmentId) patch.departmentName = String(staff.departmentId.name || staff.departmentId.title || staff.departmentId.code || '').slice(0,180);

    let basic = Number(row.basicSalary || 0), allowances = Number(row.allowances || 0), bonuses = Number(row.bonuses || 0), deductions = Number(row.deductions || 0);
    for (const [name,val] of [['basicSalary',basic],['allowances',allowances],['bonuses',bonuses],['deductions',deductions]]) {
      if (!Number.isFinite(val) || val < 0) { if(name==='basicSalary') basic=0; if(name==='allowances') allowances=0; if(name==='bonuses') bonuses=0; if(name==='deductions') deductions=0; }
    }
    const gross = basic + allowances + bonuses;
    if (deductions > gross) deductions = gross;
    const values = calculatePayrollItem({ basicSalary: basic, allowances, bonuses, deductions });
    for (const [name,val] of Object.entries(values)) if (Number(row[name] || 0) !== val) patch[name] = val;
    if (Object.keys(patch).length) await PayrollItem.collection.updateOne({ _id: row._id }, { $set: patch });
  }

  let downgradedClosedRuns = 0;
  for (const row of runs) {
    const liveItems = await PayrollItem.find({ payrollRunId: row._id, isDeleted: { $ne: true } }).lean();
    const stats = liveItems.reduce((a,x)=>({staffCount:a.staffCount+1,grossAmount:a.grossAmount+Number(x.grossPay||0),deductionsAmount:a.deductionsAmount+Number(x.deductions||0),netAmount:a.netAmount+Number(x.netPay||0)}),{staffCount:0,grossAmount:0,deductionsAmount:0,netAmount:0});
    const patch = { ...stats };
    const current = await PayrollRun.collection.findOne({ _id: row._id });
    if (current?.status === 'Closed' && liveItems.some((x) => x.status !== 'Paid')) {
      patch.status = 'Approved'; patch.closedAt = null; patch.closedBy = null; downgradedClosedRuns += 1;
    }
    await PayrollRun.collection.updateOne({ _id: row._id }, { $set: patch });
  }

  return { runs: runs.length, items: items.length, repairedRunNumbers, duplicateScopes, duplicateItems, downgradedClosedRuns };
}

module.exports = { migratePayroll, canonicalRunStatus, canonicalItemStatus };
