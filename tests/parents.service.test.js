const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PARENT_STATUSES,
  normalizeParentStatus,
  validateChildren,
  syncParentUserAccess,
  syncParentIdentity,
  csvCell,
} = require('../src/services/tenant/parentLifecycleService');

function chainResult(value) {
  return {
    select() { return this; },
    lean: async () => value,
  };
}

test('parent statuses are canonical and bounded', () => {
  assert.deepEqual(PARENT_STATUSES, ['active','on_hold','suspended','archived']);
  assert.equal(normalizeParentStatus(' SUSPENDED '), 'suspended');
  assert.equal(normalizeParentStatus('pending'), null);
});

test('parent CSV cells neutralize spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('Mother'), '"Mother"');
});

test('validateChildren rejects unavailable child links', async () => {
  const ids = ['65f111111111111111111111', '65f222222222222222222222'];
  const Student = {
    find() { return chainResult([{ _id: ids[0] }]); },
  };
  await assert.rejects(() => validateChildren({ Student }, ids), /selected children are unavailable/);
});

test('parent lifecycle never claims an already manual/security-suspended User', async () => {
  const updates = [];
  const User = {
    findOne() { return chainResult({ _id: '65f111111111111111111111', status: 'suspended', parentAccessSuspended: false, parentAccessPreviousStatus: null }); },
    updateOne: async (...args) => updates.push(args),
  };
  const req = { models: { User }, tenant: { code: 'classic' } };
  await syncParentUserAccess(req, { userId: '65f111111111111111111111' }, 'archived');
  assert.equal(updates.length, 0);
});

test('parent lifecycle suspension preserves invited status and revokes the current session', async () => {
  const updates = [];
  const User = {
    findOne() { return chainResult({ _id: '65f111111111111111111111', status: 'invited', parentAccessSuspended: false, parentAccessPreviousStatus: null }); },
    updateOne: async (...args) => updates.push(args),
  };
  const req = { models: { User }, tenant: { code: 'classic' } };
  await syncParentUserAccess(req, { userId: '65f111111111111111111111' }, 'suspended');
  assert.equal(updates.length, 1);
  const update = updates[0][1];
  assert.equal(update.$set.status, 'suspended');
  assert.equal(update.$set.parentAccessSuspended, true);
  assert.equal(update.$set.parentAccessPreviousStatus, 'invited');
  assert.equal(update.$inc.tokenVersion, 1);
});

test('parent lifecycle reactivation restores only a parent-owned suspension', async () => {
  const updates = [];
  const User = {
    findOne() { return chainResult({ _id: '65f111111111111111111111', status: 'suspended', parentAccessSuspended: true, parentAccessPreviousStatus: 'invited' }); },
    updateOne: async (...args) => updates.push(args),
  };
  const req = { models: { User }, tenant: { code: 'classic' } };
  await syncParentUserAccess(req, { userId: '65f111111111111111111111' }, 'active');
  const update = updates[0][1];
  assert.equal(update.$set.status, 'invited');
  assert.equal(update.$set.parentAccessSuspended, false);
  assert.equal(update.$set.parentAccessPreviousStatus, null);
  assert.equal(update.$inc.tokenVersion, 1);
});

test('parent identity sync updates the linked login identity and child authorization together', async () => {
  const updates = [];
  const User = { updateOne: async (...args) => updates.push(args) };
  const req = { models: { User }, tenant: { code: 'classic' } };
  await syncParentIdentity(req, {
    userId: '65f111111111111111111111',
    firstName: 'Jane', lastName: 'Doe', email: 'JANE@EXAMPLE.COM', phone: '+256700000001',
    childrenStudentIds: ['65f222222222222222222222'],
  }, { childrenStudentIds: [] });
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].$set.email, 'jane@example.com');
  assert.deepEqual(updates[0][1].$set.childrenStudentIds, ['65f222222222222222222222']);
});
