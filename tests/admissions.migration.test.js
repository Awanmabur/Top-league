const test = require('node:test');
const assert = require('node:assert/strict');
const { repairDuplicateField } = require('../scripts/lib/migrateAdmissions');

test('Admissions migration keeps the first active identifier and repairs duplicate/missing values', async () => {
  const updates = [];
  let n = 0;
  const Model = {
    exists: async () => null,
    updateOne: async (filter, update) => { updates.push({ filter, update }); },
  };
  const rows = [
    { _id: '1', applicationId: 'APP-OLD', isDeleted: false, createdAt: new Date('2026-01-01') },
    { _id: '2', applicationId: 'APP-OLD', isDeleted: false, createdAt: new Date('2026-01-02') },
    { _id: '3', applicationId: '', isDeleted: false, createdAt: new Date('2026-01-03') },
    { _id: '4', applicationId: 'APP-OLD', isDeleted: true, createdAt: new Date('2026-01-04') },
  ];
  const allocator = async () => `APP-NEW-${++n}`;
  const repaired = await repairDuplicateField(Model, rows, 'applicationId', allocator);
  assert.equal(repaired, 2);
  assert.deepEqual(updates.map((x) => x.filter._id), ['2', '3']);
  assert.deepEqual(updates.map((x) => x.update.$set.applicationId), ['APP-NEW-1', 'APP-NEW-2']);
});
