const { getStaffProfile } = require('./_helpers');

function serialize(item) {
  const run = item.payrollRunId || {};
  return {
    id: String(item._id || ''),
    runNumber: run.runNumber || '',
    title: run.title || run.periodLabel || `${run.month || ''} ${run.year || ''}`.trim() || 'Payroll item',
    period: run.periodLabel || `${run.month || ''} ${run.year || ''}`.trim(),
    payDate: run.payDate ? new Date(run.payDate).toISOString().slice(0, 10) : '',
    runStatus: run.status || '',
    basicSalary: Number(item.basicSalary || 0),
    allowances: Number(item.allowances || 0),
    bonuses: Number(item.bonuses || 0),
    deductions: Number(item.deductions || 0),
    grossPay: Number(item.grossPay || 0),
    netPay: Number(item.netPay || 0),
    status: item.status || 'Processed',
    paidAt: item.paidAt ? new Date(item.paidAt).toISOString().slice(0, 10) : '',
    paymentReference: item.paymentReference || '',
    heldReason: item.heldReason || '',
  };
}

module.exports = {
  async list(req, res) {
    try {
      const { PayrollRun, PayrollItem } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect('/login');
      let items = [];
      if (staff && PayrollRun && PayrollItem) {
        const visibleRuns = await PayrollRun.find({
          status: { $in: ['Approved', 'Closed'] },
          isDeleted: { $ne: true },
        }).select('_id').lean();
        const runIds = visibleRuns.map((row) => row._id);
        items = await PayrollItem.find({
          staffId: staff._id,
          payrollRunId: { $in: runIds },
          isDeleted: { $ne: true },
          status: { $in: ['Processed', 'Paid', 'Held'] },
        })
          .populate('payrollRunId', 'runNumber title periodLabel month year payDate status')
          .sort({ createdAt: -1 })
          .limit(24)
          .lean();
      }
      return res.render('staff/payroll', {
        tenant: req.tenant,
        user,
        staff,
        items: items.map(serialize),
        pageTitle: 'Payroll',
        error: staff ? null : 'Staff profile not found. Contact admin.',
      });
    } catch (err) {
      console.error('STAFF PAYROLL ERROR:', err);
      return res.status(500).send('Failed to load payroll');
    }
  },
};
