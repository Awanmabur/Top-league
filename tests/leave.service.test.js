const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inclusiveDays,
  normalizeLeaveType,
  normalizeStatus,
  validateLeaveInput,
  leaveOverlapsFilter,
  acquireStaffLeaveLock,
  releaseStaffLeaveLock,
  refreshStaffLeaveStatus,
  cancelLeave,
  deleteLeave,
  todayForTimezone,
} = require('../src/services/tenant/leaveService');

function queryResult(value) {
  return {
    select() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

test('leave dates use inclusive calendar-day arithmetic', () => {
  assert.equal(inclusiveDays('2026-08-01', '2026-08-01'), 1);
  assert.equal(inclusiveDays('2026-08-01', '2026-08-05'), 5);
  assert.equal(inclusiveDays('2026-08-05', '2026-08-01'), 0);
});

test('leave type/status normalization is canonical and fail closed', () => {
  assert.equal(normalizeLeaveType(' annual '), 'Annual');
  assert.equal(normalizeStatus('approved'), 'Approved');
  assert.equal(normalizeLeaveType('holiday'), null);
  assert.equal(normalizeStatus('done'), null);
});

test('leave validation rejects invalid dates/type/reason', () => {
  assert.throws(() => validateLeaveInput({ leaveType: 'Holiday', startDate: '2026-08-01', endDate: '2026-08-02', reason: 'x' }), /Invalid leave type/);
  assert.throws(() => validateLeaveInput({ leaveType: 'Annual', startDate: '2026-08-03', endDate: '2026-08-02', reason: 'x' }), /earlier/);
  assert.throws(() => validateLeaveInput({ leaveType: 'Annual', startDate: '2026-08-01', endDate: '2026-08-02', reason: ' ' }), /reason/);
});

test('overlap query blocks both Pending and Approved ranges', () => {
  const f = leaveOverlapsFilter('staff1', new Date('2026-08-01'), new Date('2026-08-03'), 'leave2');
  assert.deepEqual(f.status.$in, ['Pending', 'Approved']);
  assert.equal(f._id.$ne, 'leave2');
  assert.ok(f.startDate.$lte && f.endDate.$gte);
});

test('per-staff leave lease is acquired atomically and token-guarded on release', async () => {
  let acquireFilter, releaseFilter;
  const models = { Staff: {
    findOneAndUpdate(filter) { acquireFilter = filter; return Promise.resolve({ _id: 'staff1', status: 'Active' }); },
    updateOne(filter) { releaseFilter = filter; return Promise.resolve({ modifiedCount: 1 }); },
  } };
  const lease = await acquireStaffLeaveLock(models, 'staff1', new Date('2026-08-29T10:00:00Z'));
  assert.ok(lease.token);
  assert.equal(acquireFilter._id, 'staff1');
  assert.ok(acquireFilter.$or.some((x) => x['leaveOps.lockUntil']?.$lte));
  await releaseStaffLeaveLock(models, 'staff1', lease.token);
  assert.equal(releaseFilter['leaveOps.lockToken'], lease.token);
});

test('busy staff leave lease fails closed', async () => {
  const models = { Staff: { findOneAndUpdate: async () => null } };
  await assert.rejects(() => acquireStaffLeaveLock(models, 'staff1'), /busy/);
});

test('future approved leave does not put staff On Leave early', async () => {
  const staff = { status: 'Active', save: async () => { throw new Error('should not save'); } };
  const models = {
    Staff: { findOne: () => Promise.resolve(staff) },
    LeaveRequest: { exists: async () => null },
  };
  const status = await refreshStaffLeaveStatus(models, 'staff1', { now: new Date('2026-08-29T12:00:00Z'), timezone: 'UTC' });
  assert.equal(status, 'Active');
});

test('current approved leave sets Active staff On Leave', async () => {
  let saved = false;
  const staff = { status: 'Active', save: async () => { saved = true; } };
  const models = {
    Staff: { findOne: () => Promise.resolve(staff) },
    LeaveRequest: { exists: async () => ({ _id: 'leave1' }) },
  };
  const status = await refreshStaffLeaveStatus(models, 'staff1', { now: new Date('2026-08-29T12:00:00Z'), timezone: 'UTC' });
  assert.equal(status, 'On Leave'); assert.equal(saved, true);
});

test('leave sync never overrides Suspended or Exited staff', async () => {
  for (const original of ['Suspended', 'Exited']) {
    const staff = { status: original, save: async () => { throw new Error('should not save'); } };
    const models = { Staff: { findOne: () => Promise.resolve(staff) }, LeaveRequest: { exists: async () => ({ _id: 'x' }) } };
    assert.equal(await refreshStaffLeaveStatus(models, 'staff1'), original);
  }
});

test('staff cannot cancel an approved leave after it starts', async () => {
  const current = { _id: 'l1', status: 'Approved', startDate: new Date('2026-08-28'), staffId: 's1' };
  const models = { LeaveRequest: { findOne: () => Promise.resolve(current) } };
  await assert.rejects(() => cancelLeave(models, 'l1', { requester: 'staff', now: new Date('2026-08-29T10:00:00Z'), timezone: 'UTC' }), /started/);
});

test('approved leave history cannot be soft-deleted through normal action', async () => {
  const models = { LeaveRequest: { findOneAndUpdate: async () => null } };
  await assert.rejects(() => deleteLeave(models, 'l1'), /rejected or cancelled/);
});

test('timezone day resolver produces deterministic date-only value', () => {
  assert.equal(todayForTimezone('Africa/Kampala', new Date('2026-08-28T22:30:00Z')).toISOString().slice(0, 10), '2026-08-29');
});
