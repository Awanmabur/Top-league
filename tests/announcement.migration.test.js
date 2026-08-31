const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAudienceType,
  migrateAnnouncements,
} = require("../scripts/lib/migrateAnnouncements");

test("announcement migration normalizes legacy audience names", () => {
  assert.equal(normalizeAudienceType("Students"), "All Students");
  assert.equal(normalizeAudienceType("Parents"), "All Parents");
  assert.equal(normalizeAudienceType("Specific Class"), "Specific Program");
  assert.equal(normalizeAudienceType("Specific Subject"), "Specific Subject");
});

test("announcement migration preserves embedded receipt state in canonical receipts", async () => {
  const updates = [];
  const bulkOps = [];
  const createdAt = new Date("2026-08-20T10:00:00.000Z");
  const rows = [{
    _id: "507f1f77bcf86cd799439001",
    audienceType: "Students",
    status: "Published",
    publishedAt: null,
    createdAt,
    scheduleClaimedAt: new Date("2026-08-29T08:00:00.000Z"),
    receipts: [{
      userId: "507f1f77bcf86cd799439002",
      name: "Student One",
      email: "STUDENT@EXAMPLE.TEST",
      role: "Student",
      status: "Acknowledged",
      readAt: new Date("2026-08-21T10:00:00.000Z"),
      ackAt: new Date("2026-08-21T10:05:00.000Z"),
    }],
  }];

  const Announcement = {
    find() {
      return { select: async () => rows };
    },
    async updateOne(filter, update) {
      updates.push({ filter, update });
    },
  };
  const AnnouncementReceipt = {
    async bulkWrite(ops) {
      bulkOps.push(...ops);
    },
  };

  const result = await migrateAnnouncements({ Announcement, AnnouncementReceipt });
  assert.deepEqual(result, { scanned: 1, normalized: 1, receiptsMigrated: 1 });
  assert.equal(updates[0].update.$set.audienceType, "All Students");
  assert.equal(updates[0].update.$set.publishedAt, createdAt);
  assert.equal(updates[0].update.$set.scheduleClaimedAt, null);
  assert.equal(bulkOps[0].updateOne.update.$set.status, "Acknowledged");
  assert.equal(bulkOps[0].updateOne.update.$set.email, "student@example.test");
});
