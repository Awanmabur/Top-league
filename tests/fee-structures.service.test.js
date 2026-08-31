const test = require('node:test');
const assert = require('node:assert/strict');
const {
  structureCodeCandidate,
  parsePayload,
  validatePayload,
  createStructure,
  csvCell,
  normalizeStatus,
  escapeRegex,
} = require('../src/services/tenant/feeStructureService');

test('fee structure codes use dated cryptographic suffixes', () => {
  assert.match(structureCodeCandidate(new Date('2026-08-29T10:00:00Z')), /^FS-20260829-[A-F0-9]{10}$/);
});

test('fee structure payload keeps aligned line-item booleans and computes total', () => {
  const out = parsePayload({
    name: 'Term 1', itemTitle: ['Tuition', 'Library'], itemCategory: ['Tuition', 'Library'],
    itemAmount: ['1000', '250'], itemRequired: ['true', 'false'], itemNote: ['', 'Optional'], status: 'Active',
  });
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].required, true);
  assert.equal(out.items[1].required, false);
  assert.equal(out.totalAmount, 1250);
});

test('fee structure validation requires a named, non-zero template', () => {
  assert.throws(() => validatePayload(parsePayload({ name: '', itemTitle: 'Tuition', itemAmount: '10' })), /name/i);
  assert.throws(() => validatePayload(parsePayload({ name: 'Free', itemTitle: 'Tuition', itemAmount: '0' })), /greater than zero/i);
});

test('fee structure statuses fail to a safe Active default', () => {
  assert.equal(normalizeStatus('Archived'), 'Archived');
  assert.equal(normalizeStatus('Hacked'), 'Active');
});

test('fee structure CSV neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('=2+2'), '"\'=2+2"');
  assert.equal(csvCell('@cmd'), '"\'@cmd"');
});

test('fee structure search regex text is escaped', () => {
  assert.equal(escapeRegex('a.*(b)'), 'a\\.\\*\\(b\\)');
});

test('fee structure create retries actual duplicate-key insert races', async () => {
  let calls = 0;
  const Model = {
    async create(payload) {
      calls += 1;
      if (calls === 1) {
        const err = new Error('duplicate structureCode'); err.code = 11000; err.keyPattern = { structureCode: 1 }; throw err;
      }
      return payload;
    },
  };
  const row = await createStructure(Model, { name: 'Structure', items: [{ title: 'Tuition', amount: 10 }] });
  assert.equal(calls, 2);
  assert.match(row.structureCode, /^FS-/);
});
