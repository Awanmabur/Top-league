const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAudienceType, migrateMessages } = require("../scripts/lib/migrateMessages");

test("message migration normalizes legacy audience names", () => {
  assert.equal(normalizeAudienceType("Specific Class"), "Specific Program");
  assert.equal(normalizeAudienceType("Subject"), "Specific Subject");
  assert.equal(normalizeAudienceType("Cohort"), "Year/Cohort");
});

test("message migration preserves embedded delivery/open state in canonical recipient rows", async () => {
  const messageUpdates = [];
  const recipientOps = [];
  const rows = [{
    _id: "65f000000000000000000010",
    audienceType: "Specific Class",
    status: "Sent",
    sentAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    scheduleClaimedAt: new Date("2026-08-02T00:00:00Z"),
    recipients: [{
      userId: "65f000000000000000000011",
      name: "Student One",
      email: "STUDENT@EXAMPLE.COM",
      role: "Student",
      status: "Opened",
      deliveredAt: new Date("2026-08-01T01:00:00Z"),
      openedAt: new Date("2026-08-01T02:00:00Z"),
    }],
  }];
  const models = {
    Message: {
      find: () => ({ select: async () => rows }),
      updateOne: async (filter, patch) => { messageUpdates.push({ filter, patch }); return { matchedCount: 1 }; },
    },
    MessageRecipient: {
      bulkWrite: async (ops) => { recipientOps.push(...ops); return { ok: 1 }; },
    },
  };
  const result = await migrateMessages(models);
  assert.deepEqual(result, { scanned: 1, normalized: 1, recipientsMigrated: 1 });
  assert.equal(messageUpdates[0].patch.$set.audienceType, "Specific Program");
  assert.equal(messageUpdates[0].patch.$set.scheduleClaimedAt, null);
  assert.ok(messageUpdates[0].patch.$set.sentAt instanceof Date);
  const set = recipientOps[0].updateOne.update.$set;
  assert.equal(set.email, "student@example.com");
  assert.equal(set.status, "Opened");
  assert.ok(set.openedAt instanceof Date);
});
