const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  codeCandidate, uniqueCode, normalizePolicy, dueDateFrom, reservationTransitionAllowed,
  csvCell, parseCsv, setFineStatus, setHoldStatus, claimBookCopy, createLoan,
} = require('../src/services/tenant/libraryService');

test('library identifiers use dated cryptographic suffixes', () => {
  const code = codeCandidate('BK', new Date('2026-08-29T10:00:00Z'));
  assert.match(code, /^BK-20260829-[0-9A-F]{8}$/);
});

test('library unique-code allocator retries collisions', async () => {
  let n = 0;
  const Model = { exists: async () => (++n < 3 ? { _id: 1 } : null) };
  const code = await uniqueCode(Model, 'bookId', 'BK', new Date('2026-08-29T10:00:00Z'));
  assert.match(code, /^BK-20260829-/);
  assert.equal(n, 3);
});

test('library policy is bounded and defaults safely', () => {
  assert.deepEqual(normalizePolicy({ fineRate: -2, loanDays: 0, maxRenewals: 999 }), { fineRate: 0, loanDays: 1, maxRenewals: 12 });
  assert.deepEqual(normalizePolicy({}), { fineRate: 1000, loanDays: 14, maxRenewals: 1 });
});

test('loan due dates advance by policy days', () => {
  assert.equal(dueDateFrom(new Date('2026-08-29T00:00:00Z'), 14).toISOString().slice(0,10), '2026-09-12');
});

test('reservation lifecycle is terminal after denied/fulfilled/cancelled', () => {
  assert.equal(reservationTransitionAllowed('Pending', 'Approved'), true);
  assert.equal(reservationTransitionAllowed('Approved', 'Fulfilled'), true);
  assert.equal(reservationTransitionAllowed('Denied', 'Approved'), false);
  assert.equal(reservationTransitionAllowed('Fulfilled', 'Cancelled'), false);
});

test('library CSV export neutralizes spreadsheet formulas and parser handles quoted cells', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  const rows = parseCsv('title,author,isbn\n"A, B",Writer,123\n');
  assert.equal(rows[0].title, 'A, B');
  assert.equal(rows[0].isbn, '123');
});

test('paid and waived fines are terminal', async () => {
  const fine = { status: 'Pending', save: async () => {} };
  await setFineStatus(fine, 'Paid', 'actor');
  assert.equal(fine.status, 'Paid');
  await assert.rejects(() => setFineStatus(fine, 'Waived', 'actor'), /terminal/);
});

test('released holds are terminal', async () => {
  const hold = { status: 'Active Hold', save: async () => {} };
  await setHoldStatus(hold, 'Released', 'actor');
  assert.equal(hold.status, 'Released');
  await assert.rejects(() => setHoldStatus(hold, 'Active Hold', 'actor'), /terminal/);
});

test('copy claim is atomic and marks zero-availability title borrowed', async () => {
  let saved = 0;
  const book = { available: 0, status: 'Available', save: async () => { saved += 1; } };
  const LibraryBook = { findOneAndUpdate: async (filter, update) => {
    assert.deepEqual(filter.available, { $gt: 0 });
    assert.equal(update.$inc.available, -1);
    return book;
  }};
  const result = await claimBookCopy(LibraryBook, new mongoose.Types.ObjectId(), 'actor');
  assert.equal(result.status, 'Borrowed');
  assert.equal(saved, 1);
});

test('active library hold blocks a new loan before inventory is claimed', async () => {
  let claimed = false;
  const student = { _id: new mongoose.Types.ObjectId(), regNo: 'S1' };
  const models = {
    LibraryHold: { findOne: () => ({ lean: async () => ({ _id: 1 }) }) },
    LibraryBook: { findOneAndUpdate: async () => { claimed = true; } },
    LibraryLoan: {},
  };
  await assert.rejects(() => createLoan(models, { student, bookId: new mongoose.Types.ObjectId().toString() }), /active library hold/);
  assert.equal(claimed, false);
});
