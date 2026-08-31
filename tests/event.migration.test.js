const test = require("node:test");
const assert = require("node:assert/strict");
const { identityForLegacy, migrateEvents } = require("../scripts/lib/migrateEvents");

test("event migration derives stable legacy registration identities", () => {
  assert.equal(identityForLegacy({ userId: "507f1f77bcf86cd799439011" }), "user:507f1f77bcf86cd799439011");
  assert.equal(identityForLegacy({ email: " TEST@Example.COM " }), "email:test@example.com");
  assert.equal(identityForLegacy({ _id: "legacy-row" }), "legacy:legacy-row");
});

test("event migration normalizes legacy event fields and synchronizes canonical registration stats", async () => {
  const event = {
    _id: "507f1f77bcf86cd799439021",
    type: "Other",
    audienceType: "Specific Class",
    audienceValue: "S4",
    status: "Scheduled",
    scheduleAt: null,
    scheduleClaimedAt: new Date(),
    publishedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    capacity: -4,
    stats: { registrations: 99, checkIns: 99 },
    attendance: [{ _id: "row-1", email: "a@example.test", name: "A", status: "Checked In", checkedInAt: new Date() }],
  };
  const updates = [];
  const Event = {
    find() { return { select: async () => [event] }; },
    async updateOne(query, update) { updates.push({ query, update }); return {}; },
  };
  let migratedOps = 0;
  const EventRegistration = {
    async bulkWrite(ops) { migratedOps += ops.length; },
    async countDocuments(query) { return query.status === "Checked In" ? 1 : 1; },
  };
  const result = await migrateEvents({ Event, EventRegistration });
  assert.equal(result.scanned, 1);
  assert.equal(result.registrationsMigrated, 1);
  assert.equal(migratedOps, 1);
  assert.ok(updates.some((x) => x.update.$set?.type === "General" && x.update.$set?.audienceType === "Specific Program"));
  assert.ok(updates.some((x) => x.update.$set?.["stats.registrations"] === 1 && x.update.$set?.["stats.checkIns"] === 1));
});
