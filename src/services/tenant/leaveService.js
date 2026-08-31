const crypto = require('crypto');

const LEAVE_TYPES = Object.freeze([
  'Annual', 'Sick', 'Maternity', 'Paternity', 'Study', 'Compassionate', 'Unpaid', 'Other',
]);
const LEAVE_STATUSES = Object.freeze(['Pending', 'Approved', 'Rejected', 'Cancelled']);

const str = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const idString = (value) => String(value?._id || value || '');

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function todayForTimezone(timezone = 'UTC', now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return dateOnly(`${map.year}-${map.month}-${map.day}`) || dateOnly(now);
  } catch (_) {
    return dateOnly(now);
  }
}

function inclusiveDays(startValue, endValue) {
  const start = dateOnly(startValue);
  const end = dateOnly(endValue);
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function normalizeLeaveType(value) {
  const input = str(value, 40).toLowerCase();
  return LEAVE_TYPES.find((item) => item.toLowerCase() === input) || null;
}

function normalizeStatus(value) {
  const input = str(value, 40).toLowerCase();
  return LEAVE_STATUSES.find((item) => item.toLowerCase() === input) || null;
}

function validateLeaveInput(input = {}) {
  const leaveType = normalizeLeaveType(input.leaveType || 'Annual');
  const startDate = dateOnly(input.startDate);
  const endDate = dateOnly(input.endDate);
  const reason = str(input.reason, 2000);
  if (!leaveType) throw new Error('Invalid leave type.');
  if (!startDate || !endDate) throw new Error('Start date and end date are required.');
  if (endDate < startDate) throw new Error('End date cannot be earlier than start date.');
  if (!reason) throw new Error('A leave reason is required.');
  return { leaveType, startDate, endDate, days: inclusiveDays(startDate, endDate), reason };
}

function leaveOverlapsFilter(staffId, startDate, endDate, excludeId = null, statuses = ['Pending', 'Approved']) {
  const filter = {
    staffId,
    isDeleted: { $ne: true },
    status: { $in: statuses },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return filter;
}

async function assertNoOverlap(models, staffId, startDate, endDate, excludeId = null, statuses) {
  const overlap = await models.LeaveRequest.findOne(
    leaveOverlapsFilter(staffId, startDate, endDate, excludeId, statuses)
  ).select('_id status startDate endDate').lean();
  if (overlap) throw new Error('This staff member already has an overlapping leave request.');
  return true;
}

function lockUntil(now = new Date()) {
  return new Date(now.getTime() + 30_000);
}

async function acquireStaffLeaveLock(models, staffId, now = new Date()) {
  const token = crypto.randomUUID();
  const staff = await models.Staff.findOneAndUpdate(
    {
      _id: staffId,
      isDeleted: { $ne: true },
      $or: [
        { 'leaveOps.lockUntil': { $exists: false } },
        { 'leaveOps.lockUntil': null },
        { 'leaveOps.lockUntil': { $lte: now } },
      ],
    },
    { $set: { 'leaveOps.lockToken': token, 'leaveOps.lockUntil': lockUntil(now) } },
    { new: true }
  );
  if (!staff) throw new Error('Staff leave record is busy. Please retry.');
  return { token, staff };
}

async function releaseStaffLeaveLock(models, staffId, token) {
  if (!models?.Staff || !staffId || !token) return;
  await models.Staff.updateOne(
    { _id: staffId, 'leaveOps.lockToken': token },
    { $set: { 'leaveOps.lockToken': null, 'leaveOps.lockUntil': null } }
  ).catch(() => null);
}

async function withStaffLeaveLock(models, staffId, fn) {
  const { token, staff } = await acquireStaffLeaveLock(models, staffId);
  try {
    return await fn(staff);
  } finally {
    await releaseStaffLeaveLock(models, staffId, token);
  }
}

async function notifyStaff(models, leave, title, message, type = 'info', actorUserId = null) {
  if (!models?.Notification || !leave?.userId) return;
  await models.Notification.create({
    audience: 'staff',
    userId: leave.userId,
    title: str(title, 140),
    message: str(message, 5000),
    type,
    url: '/staff/leave',
    entityType: 'LeaveRequest',
    entityId: leave._id,
    createdBy: actorUserId || null,
  }).catch(() => null);
}


async function notifyAdmins(models, leave, title, message, type = 'info', actorUserId = null) {
  if (!models?.Notification || !leave) return;
  await models.Notification.create({
    audience: 'admin',
    userId: null,
    title: str(title, 140),
    message: str(message, 5000),
    type,
    url: '/admin/staff-leave',
    entityType: 'LeaveRequest',
    entityId: leave._id,
    createdBy: actorUserId || null,
  }).catch(() => null);
}

async function refreshStaffLeaveStatus(models, staffId, options = {}) {
  if (!models?.Staff || !models?.LeaveRequest || !staffId) return null;
  const staff = await models.Staff.findOne({ _id: staffId, isDeleted: { $ne: true } });
  if (!staff || ['Suspended', 'Exited'].includes(staff.status)) return staff?.status || null;
  const day = todayForTimezone(options.timezone || 'UTC', options.now || new Date());
  const active = await models.LeaveRequest.exists({
    staffId,
    status: 'Approved',
    isDeleted: { $ne: true },
    startDate: { $lte: day },
    endDate: { $gte: day },
  });
  const target = active ? 'On Leave' : 'Active';
  if (staff.status !== target && ['Active', 'On Leave'].includes(staff.status)) {
    staff.status = target;
    if (options.actorUserId) staff.updatedBy = options.actorUserId;
    await staff.save();
  }
  return staff.status;
}

async function createLeave(models, input = {}, context = {}) {
  if (!models?.LeaveRequest || !models?.Staff) throw new Error('Leave models are unavailable.');
  const staffId = idString(input.staffId);
  if (!staffId) throw new Error('A staff member is required.');
  const clean = validateLeaveInput(input);
  return withStaffLeaveLock(models, staffId, async (staff) => {
    if (['Suspended', 'Exited'].includes(staff.status)) throw new Error('Leave cannot be created for suspended or exited staff.');
    await assertNoOverlap(models, staffId, clean.startDate, clean.endDate);
    const created = await models.LeaveRequest.create({
      staffId,
      userId: staff.userId || input.userId || null,
      ...clean,
      attachmentUrl: str(input.attachmentUrl, 1000),
      status: 'Pending',
      createdBy: context.actorUserId || input.userId || null,
      updatedBy: context.actorUserId || input.userId || null,
    });
    if (context.requester === 'staff') {
      await notifyAdmins(models, created, 'New leave request', `${staff.firstName || 'Staff'} ${staff.lastName || ''} submitted a ${created.leaveType} leave request.`, 'info', context.actorUserId);
    }
    return created;
  });
}

async function updatePendingLeave(models, leaveId, input = {}, context = {}) {
  const existing = await models.LeaveRequest.findOne({ _id: leaveId, isDeleted: { $ne: true } });
  if (!existing) throw new Error('Leave request not found.');
  if (existing.status !== 'Pending') throw new Error('Only pending leave requests can be edited.');
  const requestedStaffId = idString(input.staffId || existing.staffId);
  if (requestedStaffId !== idString(existing.staffId)) throw new Error('The staff member cannot be changed after a leave request is created.');
  const clean = validateLeaveInput(input);
  return withStaffLeaveLock(models, requestedStaffId, async () => {
    await assertNoOverlap(models, requestedStaffId, clean.startDate, clean.endDate, existing._id);
    const updated = await models.LeaveRequest.findOneAndUpdate(
      { _id: existing._id, status: 'Pending', isDeleted: { $ne: true } },
      { $set: { ...clean, attachmentUrl: str(input.attachmentUrl ?? existing.attachmentUrl, 1000), updatedBy: context.actorUserId || null } },
      { new: true }
    );
    if (!updated) throw new Error('Leave request changed before this edit could be saved.');
    return updated;
  });
}

async function approveLeave(models, leaveId, context = {}) {
  const leave = await models.LeaveRequest.findOne({ _id: leaveId, status: 'Pending', isDeleted: { $ne: true } });
  if (!leave) throw new Error('Only a pending leave request can be approved.');
  return withStaffLeaveLock(models, leave.staffId, async () => {
    await assertNoOverlap(models, leave.staffId, leave.startDate, leave.endDate, leave._id, ['Approved']);
    const approved = await models.LeaveRequest.findOneAndUpdate(
      { _id: leave._id, status: 'Pending', isDeleted: { $ne: true } },
      { $set: { status: 'Approved', approvedBy: context.actorUserId || null, approvedAt: new Date(), rejectionReason: '', updatedBy: context.actorUserId || null } },
      { new: true }
    );
    if (!approved) throw new Error('Leave request changed before approval completed.');
    await refreshStaffLeaveStatus(models, approved.staffId, context);
    await notifyStaff(models, approved, 'Leave approved', `Your ${approved.leaveType} leave request has been approved.`, 'success', context.actorUserId);
    return approved;
  });
}

async function rejectLeave(models, leaveId, reason, context = {}) {
  const rejectionReason = str(reason, 1000);
  if (rejectionReason.length < 3) throw new Error('A rejection reason is required.');
  const rejected = await models.LeaveRequest.findOneAndUpdate(
    { _id: leaveId, status: 'Pending', isDeleted: { $ne: true } },
    { $set: { status: 'Rejected', rejectionReason, approvedBy: null, approvedAt: null, updatedBy: context.actorUserId || null } },
    { new: true }
  );
  if (!rejected) throw new Error('Only a pending leave request can be rejected.');
  await notifyStaff(models, rejected, 'Leave rejected', `Your ${rejected.leaveType} leave request was rejected: ${rejectionReason}`, 'warning', context.actorUserId);
  return rejected;
}

async function cancelLeave(models, leaveId, context = {}) {
  const current = await models.LeaveRequest.findOne({ _id: leaveId, status: { $in: ['Pending', 'Approved'] }, isDeleted: { $ne: true } });
  if (!current) throw new Error('Only a pending or approved leave request can be cancelled.');
  const day = todayForTimezone(context.timezone || 'UTC', context.now || new Date());
  if (context.requester === 'staff' && current.status === 'Approved' && dateOnly(current.startDate) <= day) {
    throw new Error('An approved leave that has started must be cancelled by an administrator.');
  }
  const cancelled = await models.LeaveRequest.findOneAndUpdate(
    { _id: current._id, status: current.status, isDeleted: { $ne: true } },
    { $set: { status: 'Cancelled', updatedBy: context.actorUserId || null } },
    { new: true }
  );
  if (!cancelled) throw new Error('Leave request changed before cancellation completed.');
  await refreshStaffLeaveStatus(models, cancelled.staffId, context);
  await notifyStaff(models, cancelled, 'Leave cancelled', `Your ${cancelled.leaveType} leave request has been cancelled.`, 'info', context.actorUserId);
  if (context.requester === 'staff') {
    await notifyAdmins(models, cancelled, 'Leave request cancelled', `A staff member cancelled a ${cancelled.leaveType} leave request.`, 'info', context.actorUserId);
  }
  return cancelled;
}

async function deleteLeave(models, leaveId, context = {}) {
  const deleted = await models.LeaveRequest.findOneAndUpdate(
    { _id: leaveId, status: { $in: ['Rejected', 'Cancelled'] }, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: context.actorUserId || null } },
    { new: true }
  );
  if (!deleted) throw new Error('Only rejected or cancelled leave requests can be deleted.');
  return deleted;
}

async function processLeaveStatuses(context = {}, now = new Date()) {
  const { models, tenant } = context;
  if (!models?.Staff || !models?.LeaveRequest) return 0;
  const timezone = tenant?.timezone || 'UTC';
  const day = todayForTimezone(timezone, now);
  const [approvedIds, onLeave] = await Promise.all([
    models.LeaveRequest.distinct('staffId', {
      status: 'Approved', isDeleted: { $ne: true }, endDate: { $gte: day },
    }),
    models.Staff.find({ status: 'On Leave', isDeleted: { $ne: true } }).select('_id').lean(),
  ]);
  const ids = new Set([...approvedIds.map(String), ...onLeave.map((row) => String(row._id))]);
  let changed = 0;
  for (const id of ids) {
    const before = await models.Staff.findById(id).select('status').lean();
    const after = await refreshStaffLeaveStatus(models, id, { timezone, now });
    if (before && after && before.status !== after) changed += 1;
  }
  return changed;
}

module.exports = {
  LEAVE_TYPES,
  LEAVE_STATUSES,
  dateOnly,
  todayForTimezone,
  inclusiveDays,
  normalizeLeaveType,
  normalizeStatus,
  validateLeaveInput,
  leaveOverlapsFilter,
  assertNoOverlap,
  acquireStaffLeaveLock,
  releaseStaffLeaveLock,
  withStaffLeaveLock,
  notifyStaff,
  notifyAdmins,
  refreshStaffLeaveStatus,
  createLeave,
  updatePendingLeave,
  approveLeave,
  rejectLeave,
  cancelLeave,
  deleteLeave,
  processLeaveStatuses,
};
