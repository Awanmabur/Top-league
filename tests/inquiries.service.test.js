const test = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeRegex,
  normalizeStatus,
  buildInquiryFilter,
  csvCell,
  canMarkRead,
  canResolve,
} = require('../src/services/tenant/inquiryService');

test('inquiry regex search escapes metacharacters', () => {
  assert.equal(escapeRegex('a+b?(test)[x]'), 'a\\+b\\?\\(test\\)\\[x\\]');
});

test('inquiry statuses normalize fail-closed to new', () => {
  assert.equal(normalizeStatus('READ'), 'read');
  assert.equal(normalizeStatus('resolved'), 'resolved');
  assert.equal(normalizeStatus('hacked'), 'new');
});

test('new inquiry filter includes legacy rows missing status and excludes deleted rows', () => {
  const filter = buildInquiryFilter({ q: 'a+b', status: 'new' });
  assert.ok(filter.$and);
  assert.deepEqual(filter.$and[0], { isDeleted: { $ne: true } });
  const search = filter.$and[1].$or[0].name;
  assert.ok(search instanceof RegExp);
  assert.equal(search.source, 'a\\+b');
  assert.ok(filter.$and[2].$or.some((x) => x.status && x.status.$exists === false));
});

test('CSV export neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('=cmd|x'), '"\'=cmd|x"');
  assert.equal(csvCell('normal'), '"normal"');
});

test('resolved inquiry is terminal for read/resolve lifecycle helpers', () => {
  assert.equal(canMarkRead('new'), true);
  assert.equal(canMarkRead('read'), true);
  assert.equal(canMarkRead('resolved'), false);
  assert.equal(canResolve('new'), true);
  assert.equal(canResolve('read'), true);
  assert.equal(canResolve('resolved'), false);
});
