const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertIntakeTransition,
  bool,
  canTransitionIntake,
  intakeAllowsSection,
  isIntakePubliclyOpen,
  normalizeIntakeProgramRows,
  normalizeRequirementScope,
  objectIdString,
  offerContentHash,
  offerCurrentKey,
  offerSendState,
  parseCsvBuffer,
  parseCsvRecord,
  requirementApplies,
  requirementSnapshot,
  validateIntakeDates,
} = require('../src/services/tenant/admissionsOperationsService');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';

test('boolean normalization accepts normal form truth values', () => {
  for (const v of [true, 'true', '1', 'yes', 'on']) assert.equal(bool(v), true);
  for (const v of [false, 'false', '0', 'no', 'off']) assert.equal(bool(v), false);
});

test('object id normalization rejects malformed identifiers', () => {
  assert.equal(objectIdString(A), A);
  assert.equal(objectIdString('not-an-id'), null);
});

test('intake program normalization deduplicates Sections and bounds capacity', () => {
  const rows = normalizeIntakeProgramRows([{ program: A, capacity: -4 }, { program: A, capacity: 99 }, { program: B, capacity: 12, isOpen: false }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].capacity, 0);
  assert.equal(rows[1].isOpen, false);
});

test('intake program normalization rejects invalid Section ids', () => {
  assert.deepEqual(normalizeIntakeProgramRows([{ program: 'bad', capacity: 3 }]), []);
});

test('intake date validation accepts ordered application and study dates', () => {
  assert.equal(validateIntakeDates({ applicationOpenDate: new Date('2026-01-01'), applicationCloseDate: new Date('2026-01-02'), startDate: new Date('2026-02-01'), endDate: new Date('2026-03-01') }), true);
});

test('intake date validation rejects reversed application dates', () => {
  assert.throws(() => validateIntakeDates({ applicationOpenDate: new Date('2026-02-01'), applicationCloseDate: new Date('2026-01-01') }), /open date/i);
});

test('intake date validation rejects reversed study dates', () => {
  assert.throws(() => validateIntakeDates({ startDate: new Date('2026-04-01'), endDate: new Date('2026-03-01') }), /start date/i);
});

test('draft intake may open or archive', () => {
  assert.equal(canTransitionIntake('draft', 'open'), true);
  assert.equal(canTransitionIntake('draft', 'archived'), true);
});

test('open intake may close or return to draft', () => {
  assert.equal(canTransitionIntake('open', 'closed'), true);
  assert.equal(canTransitionIntake('open', 'draft'), true);
});

test('closed intake may reopen or archive', () => {
  assert.equal(canTransitionIntake('closed', 'open'), true);
  assert.equal(canTransitionIntake('closed', 'archived'), true);
});

test('archived intake is terminal', () => {
  assert.equal(canTransitionIntake('archived', 'open'), false);
  assert.throws(() => assertIntakeTransition('archived', 'open'), /cannot move/i);
});

test('public Intake must have open status', () => {
  assert.equal(isIntakePubliclyOpen({ status: 'draft' }, new Date('2026-01-01')), false);
  assert.equal(isIntakePubliclyOpen({ status: 'open' }, new Date('2026-01-01')), true);
});

test('public Intake honors application open date', () => {
  assert.equal(isIntakePubliclyOpen({ status: 'open', applicationOpenDate: new Date('2026-02-01') }, new Date('2026-01-31')), false);
});

test('public Intake honors application close date', () => {
  assert.equal(isIntakePubliclyOpen({ status: 'open', applicationCloseDate: new Date('2026-02-01') }, new Date('2026-02-02')), false);
});

test('deleted Intake is never publicly open', () => {
  assert.equal(isIntakePubliclyOpen({ status: 'open', isDeleted: true }, new Date()), false);
});

test('unrestricted Intake accepts any valid Section', () => {
  assert.equal(intakeAllowsSection({ programs: [] }, A), true);
});

test('configured Intake only accepts listed Section', () => {
  assert.equal(intakeAllowsSection({ programs: [{ program: A, isOpen: true }] }, A), true);
  assert.equal(intakeAllowsSection({ programs: [{ program: A, isOpen: true }] }, B), false);
});

test('configured Intake rejects closed Section row', () => {
  assert.equal(intakeAllowsSection({ programs: [{ program: A, isOpen: false }] }, A), false);
});

test('requirement scope rejects empty specific Section scope', () => {
  assert.throws(() => normalizeRequirementScope({ appliesToAllPrograms: false, programs: [], appliesToAllIntakes: true }), /Section/i);
});

test('requirement scope rejects empty specific Intake scope', () => {
  assert.throws(() => normalizeRequirementScope({ appliesToAllPrograms: true, appliesToAllIntakes: false, intakes: [] }), /Intake/i);
});

test('requirement scope deduplicates valid reference ids', () => {
  const out = normalizeRequirementScope({ appliesToAllPrograms: false, programs: [A, A, B], appliesToAllIntakes: false, intakes: [C, C] });
  assert.deepEqual(out.programs, [A, B]);
  assert.deepEqual(out.intakes, [C]);
});

test('inactive/deleted requirement never applies publicly', () => {
  assert.equal(requirementApplies({ isActive: false, appliesToAllPrograms: true, appliesToAllIntakes: true }, A, B), false);
  assert.equal(requirementApplies({ isDeleted: true, appliesToAllPrograms: true, appliesToAllIntakes: true }, A, B), false);
});

test('specific requirement requires both Section and Intake scope', () => {
  const r = { isActive: true, appliesToAllPrograms: false, programs: [A], appliesToAllIntakes: false, intakes: [B] };
  assert.equal(requirementApplies(r, A, B), true);
  assert.equal(requirementApplies(r, A, C), false);
});

test('requirement snapshot includes only applicable active rows in sort order', () => {
  const rows = [
    { _id: B, title: 'Second', code: 'B', category: 'document', sortOrder: 20, isActive: true, appliesToAllPrograms: true, appliesToAllIntakes: true },
    { _id: A, title: 'First', code: 'A', category: 'fee', feeAmount: 1000, currency: 'UGX', sortOrder: 10, isActive: true, appliesToAllPrograms: true, appliesToAllIntakes: true },
    { _id: C, title: 'Hidden', isActive: false, appliesToAllPrograms: true, appliesToAllIntakes: true },
  ];
  const snap = requirementSnapshot(rows, A, B);
  assert.deepEqual(snap.map((x) => x.title), ['First', 'Second']);
  assert.equal(snap[0].feeAmount, 1000);
});

test('requirement snapshot normalizes invalid category/currency conservatively', () => {
  const [snap] = requirementSnapshot([{ _id: A, title: 'X', category: 'weird', currency: '$$$', isActive: true, appliesToAllPrograms: true, appliesToAllIntakes: true }], A, B);
  assert.equal(snap.category, 'other');
  assert.equal(snap.currency, 'UGX');
});

test('CSV parser handles quoted commas', () => {
  assert.deepEqual(parseCsvRecord('A,"B,C",D'), ['A', 'B,C', 'D']);
});

test('CSV parser handles escaped quotes', () => {
  assert.deepEqual(parseCsvRecord('A,"B""C",D'), ['A', 'B"C', 'D']);
});

test('CSV buffer parser handles multiline quoted cells', () => {
  const parsed = parseCsvBuffer(Buffer.from('title,description\nA,"line1\nline2"\n'));
  assert.equal(parsed.rows[0].description, 'line1\nline2');
});

test('CSV buffer parser rejects mismatched column count', () => {
  assert.throws(() => parseCsvBuffer(Buffer.from('a,b\n1\n')), /columns/i);
});

test('offer content hash is deterministic and tamper-sensitive', () => {
  const h = offerContentHash('Subject', '<p>Hello</p>');
  assert.equal(h, offerContentHash('Subject', '<p>Hello</p>'));
  assert.notEqual(h, offerContentHash('Subject!', '<p>Hello</p>'));
});

test('offer current key binds applicant and Intake', () => {
  assert.equal(offerCurrentKey(A, B), `${A}:${B}`);
  assert.equal(offerCurrentKey(A, null), `${A}:none`);
});

test('offer current key rejects invalid applicant id', () => {
  assert.throws(() => offerCurrentKey('bad', B), /Applicant id/i);
});

test('draft unsent offer is sendable', () => {
  assert.equal(offerSendState({ status: 'draft', deliveryStatus: 'not_sent' }).allowed, true);
});

test('sent offer cannot be resent through normal lifecycle', () => {
  assert.equal(offerSendState({ status: 'sent', deliveryStatus: 'sent' }).allowed, false);
});

test('sending offer remains fail-safe blocked pending reconciliation', () => {
  assert.match(offerSendState({ status: 'draft', deliveryStatus: 'sending' }).reason, /progress|reconciliation/i);
});

test('void offer cannot be sent', () => {
  assert.equal(offerSendState({ status: 'void', deliveryStatus: 'not_sent' }).allowed, false);
});
