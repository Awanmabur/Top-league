const { dateOnly, inclusiveDays, normalizeLeaveType, normalizeStatus, processLeaveStatuses } = require('../../src/services/tenant/leaveService');

async function migrateLeaveRequests(models = {}, options = {}) {
  const { LeaveRequest, Staff } = models;
  if (!LeaveRequest) return { scanned: 0, normalized: 0, userIdsBackfilled: 0, invalidDates: 0, overlapWarnings: 0, staffStatusesSynced: 0 };
  const rows = await LeaveRequest.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  let normalized = 0, userIdsBackfilled = 0, invalidDates = 0, overlapWarnings = 0;
  for (const row of rows) {
    const patch = {};
    const startDate = dateOnly(row.startDate || row.from);
    const endDate = dateOnly(row.endDate || row.to);
    if (startDate && endDate && endDate >= startDate) {
      if (!row.startDate || dateOnly(row.startDate)?.getTime() !== startDate.getTime()) patch.startDate = startDate;
      if (!row.endDate || dateOnly(row.endDate)?.getTime() !== endDate.getTime()) patch.endDate = endDate;
      const days = inclusiveDays(startDate, endDate);
      if (Number(row.days || 0) !== days) patch.days = days;
    } else {
      invalidDates += 1;
    }
    const status = normalizeStatus(row.status) || 'Pending';
    if (row.status !== status) patch.status = status;
    const leaveType = normalizeLeaveType(row.leaveType) || 'Other';
    if (row.leaveType !== leaveType) patch.leaveType = leaveType;
    if (typeof row.reason !== 'string') patch.reason = String(row.reason || '').slice(0, 2000);
    if (!row.userId && row.staffId && Staff) {
      const staff = await Staff.findById(row.staffId).select('userId').lean();
      if (staff?.userId) { patch.userId = staff.userId; userIdsBackfilled += 1; }
    }
    if (Object.keys(patch).length) {
      await LeaveRequest.collection.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }

  const active = await LeaveRequest.find({ status: { $in: ['Pending', 'Approved'] }, isDeleted: { $ne: true } })
    .select('_id staffId startDate endDate status').sort({ staffId: 1, startDate: 1, createdAt: 1 }).lean();
  const byStaff = new Map();
  for (const row of active) {
    const key = String(row.staffId || '');
    if (!key) continue;
    if (!byStaff.has(key)) byStaff.set(key, []);
    const list = byStaff.get(key);
    if (list.some((prev) => dateOnly(prev.startDate) <= dateOnly(row.endDate) && dateOnly(prev.endDate) >= dateOnly(row.startDate))) overlapWarnings += 1;
    list.push(row);
  }

  let staffStatusesSynced = 0;
  if (Staff) {
    staffStatusesSynced = await processLeaveStatuses({ models, tenant: { timezone: options.timezone || 'UTC' } }, options.now || new Date()).catch(() => 0);
  }
  return { scanned: rows.length, normalized, userIdsBackfilled, invalidDates, overlapWarnings, staffStatusesSynced };
}

module.exports = { migrateLeaveRequests };
