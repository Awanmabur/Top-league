const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrateAdmissionsOperations,
  migrateIntakes,
  migrateOffers,
  migrateRequirements,
  migrateTemplates,
} = require('../scripts/lib/migrateAdmissionsOperations');
const { offerContentHash } = require('../src/services/tenant/admissionsOperationsService');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';
const D = 'dddddddddddddddddddddddd';

function clone(x) { return structuredClone(x); }
function match(row, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    const actual = row[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return String(actual ?? '') !== String(v.$ne ?? '');
    }
    return String(actual ?? '') === String(v ?? '');
  });
}
function makeModel(initial) {
  const rows = clone(initial);
  const updates = [];
  return {
    rows, updates,
    find() {
      return {
        sort() { return this; },
        async lean() { return clone(rows); },
      };
    },
    async updateOne(filter, update) {
      const row = rows.find((r) => match(r, filter));
      updates.push({ filter: clone(filter), update: clone(update) });
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, clone(update.$set || {}));
      if (update.$inc) for (const [k, n] of Object.entries(update.$inc)) row[k] = Number(row[k] || 0) + Number(n || 0);
      return { modifiedCount: 1 };
    },
  };
}

test('Intake migration keeps only the newest valid active open Intake', async () => {
  const Intake = makeModel([
    { _id: A, status: 'open', isActive: true, updatedAt: new Date('2026-01-01'), revision: 1, programs: [] },
    { _id: B, status: 'open', isActive: true, updatedAt: new Date('2026-02-01'), revision: 1, programs: [] },
  ]);
  const result = await migrateIntakes(Intake);
  assert.equal(Intake.rows.find((r) => r._id === A).isActive, false);
  assert.equal(Intake.rows.find((r) => r._id === B).isActive, true);
  assert.equal(result.duplicateActivesCleared, 1);
});

test('Intake migration deactivates an active closed Intake', async () => {
  const Intake = makeModel([{ _id: A, status: 'closed', isActive: true, revision: 1, programs: [] }]);
  await migrateIntakes(Intake);
  assert.equal(Intake.rows[0].isActive, false);
});

test('Intake migration quarantines reversed date lifecycle back to draft', async () => {
  const Intake = makeModel([{ _id: A, status: 'open', isActive: true, applicationOpenDate: new Date('2026-03-01'), applicationCloseDate: new Date('2026-02-01'), revision: 1, programs: [] }]);
  await migrateIntakes(Intake);
  assert.equal(Intake.rows[0].status, 'draft');
  assert.equal(Intake.rows[0].isActive, false);
});

test('Intake migration deduplicates Section program rows and normalizes capacity', async () => {
  const Intake = makeModel([{ _id: A, status: 'draft', isActive: false, revision: 0, programs: [{ program: B, capacity: -1 }, { program: B, capacity: 10 }] }]);
  await migrateIntakes(Intake);
  assert.equal(Intake.rows[0].programs.length, 1);
  assert.equal(Intake.rows[0].programs[0].capacity, 0);
  assert.equal(Intake.rows[0].revision, 1);
});

test('Requirement migration quarantines empty specific Section scope', async () => {
  const Requirement = makeModel([{ _id: A, appliesToAllPrograms: false, programs: [], appliesToAllIntakes: true, intakes: [], isActive: true, revision: 1, category: 'document', currency: 'UGX' }]);
  const Section = makeModel([{ _id: B }]);
  const Intake = makeModel([{ _id: C }]);
  const result = await migrateRequirements(Requirement, Section, Intake);
  assert.equal(Requirement.rows[0].isActive, false);
  assert.equal(Requirement.rows[0].migrationQuarantined, true);
  assert.match(Requirement.rows[0].quarantineReason, /Section/);
  assert.equal(result.quarantined, 1);
});

test('Requirement migration removes unresolved scoped references and quarantines safely', async () => {
  const Requirement = makeModel([{ _id: A, appliesToAllPrograms: false, programs: [D], appliesToAllIntakes: false, intakes: [C], isActive: true, revision: 1, category: 'weird', currency: '$' }]);
  const Section = makeModel([{ _id: B }]);
  const Intake = makeModel([{ _id: C }]);
  await migrateRequirements(Requirement, Section, Intake);
  assert.deepEqual(Requirement.rows[0].programs, []);
  assert.equal(Requirement.rows[0].category, 'other');
  assert.equal(Requirement.rows[0].currency, 'UGX');
  assert.equal(Requirement.rows[0].migrationQuarantined, true);
});

test('Requirement migration preserves valid specific scopes without broadening', async () => {
  const Requirement = makeModel([{ _id: A, appliesToAllPrograms: false, programs: [B], appliesToAllIntakes: false, intakes: [C], isActive: true, revision: 1, category: 'document', currency: 'UGX' }]);
  const Section = makeModel([{ _id: B }]);
  const Intake = makeModel([{ _id: C }]);
  await migrateRequirements(Requirement, Section, Intake);
  assert.deepEqual(Requirement.rows[0].programs, [B]);
  assert.deepEqual(Requirement.rows[0].intakes, [C]);
  assert.notEqual(Requirement.rows[0].migrationQuarantined, true);
});

test('Offer template migration elects one active singleton and deactivates extras', async () => {
  const Templates = makeModel([
    { _id: A, isActive: true, isDeleted: false, revision: 1 },
    { _id: B, isActive: true, isDeleted: false, revision: 1 },
  ]);
  const result = await migrateTemplates(Templates);
  assert.equal(Templates.rows.find((r) => r._id === A).singletonKey, 'default');
  assert.equal(Templates.rows.find((r) => r._id === B).isActive, false);
  assert.equal(result.singletonChosen, 1);
});

test('Offer migration backfills checksum, current key, revision and sent delivery state', async () => {
  const Offers = makeModel([{ _id: D, applicant: A, intakeId: B, status: 'sent', sentAt: new Date('2026-01-01'), subject: 'Hi', bodyHtml: '<p>X</p>', revision: 0, deliveryStatus: '', currentKey: null }]);
  await migrateOffers(Offers);
  assert.equal(Offers.rows[0].contentHash, offerContentHash('Hi', '<p>X</p>'));
  assert.equal(Offers.rows[0].currentKey, `${A}:${B}`);
  assert.equal(Offers.rows[0].revision, 1);
  assert.equal(Offers.rows[0].deliveryStatus, 'sent');
});

test('Offer migration keeps strongest duplicate current offer and voids the other', async () => {
  const Offers = makeModel([
    { _id: C, applicant: A, intakeId: B, status: 'draft', subject: 'D', bodyHtml: 'D', revision: 1, deliveryStatus: 'not_sent', createdAt: new Date('2026-02-01') },
    { _id: D, applicant: A, intakeId: B, status: 'sent', sentAt: new Date('2026-01-01'), subject: 'S', bodyHtml: 'S', revision: 1, deliveryStatus: 'sent', createdAt: new Date('2026-01-01') },
  ]);
  const result = await migrateOffers(Offers);
  assert.equal(Offers.rows.find((r) => r._id === D).currentKey, `${A}:${B}`);
  const loser = Offers.rows.find((r) => r._id === C);
  assert.equal(loser.status, 'void');
  assert.equal(loser.currentKey, null);
  assert.match(loser.voidReason, /duplicate/i);
  assert.equal(result.duplicateCurrentVoided, 1);
});

test('Offer migration preserves uncertain sending state rather than making it resendable', async () => {
  const Offers = makeModel([{ _id: C, applicant: A, intakeId: B, status: 'draft', subject: 'D', bodyHtml: 'D', revision: 1, deliveryStatus: 'sending', sendClaimToken: 'claim', sendClaimAt: new Date() }]);
  await migrateOffers(Offers);
  assert.equal(Offers.rows[0].deliveryStatus, 'sending');
  assert.equal(Offers.rows[0].sendClaimToken, 'claim');
});

test('full Admissions Operations migration is idempotent after first normalization', async () => {
  const models = {
    Intake: makeModel([{ _id: B, status: 'open', isActive: true, revision: 1, programs: [] }]),
    AdmissionRequirement: makeModel([{ _id: C, appliesToAllPrograms: true, programs: [], appliesToAllIntakes: true, intakes: [], isActive: true, revision: 1, category: 'document', currency: 'UGX', feeAmount: 0 }]),
    Section: makeModel([{ _id: A }]),
    OfferLetterTemplate: makeModel([{ _id: A, isActive: true, isDeleted: false, singletonKey: 'default', revision: 1 }]),
    OfferLetter: makeModel([{ _id: D, applicant: A, intakeId: B, status: 'draft', subject: 'Hi', bodyHtml: 'Body', contentHash: offerContentHash('Hi', 'Body'), currentKey: `${A}:${B}`, revision: 1, deliveryStatus: 'not_sent', sendAttempts: 0 }]),
  };
  await migrateAdmissionsOperations(models);
  for (const model of Object.values(models)) if (model?.updates) model.updates.length = 0;
  await migrateAdmissionsOperations(models);
  assert.equal(models.Intake.updates.length, 0);
  assert.equal(models.AdmissionRequirement.updates.length, 0);
  assert.equal(models.OfferLetterTemplate.updates.length, 0);
  assert.equal(models.OfferLetter.updates.length, 0);
});
