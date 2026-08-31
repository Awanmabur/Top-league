const test = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeRegex,
  normalizeAudienceType,
  materializeMessageRecipients,
  dispatchMessage,
  markMessageOpened,
} = require("../src/services/tenant/messageService");

function chain(value) {
  return {
    select() { return this; },
    sort() { return this; },
    lean: async () => value,
  };
}

function emptyAudienceModels() {
  const updates = [];
  const deletions = [];
  const notifications = [];
  return {
    updates,
    deletions,
    notifications,
    models: {
      User: { find: () => chain([]) },
      MessageRecipient: {
        deleteMany: async (filter) => { deletions.push(filter); return { deletedCount: 0 }; },
        countDocuments: async () => 0,
        bulkWrite: async () => ({ ok: 1 }),
        updateOne: async () => ({ modifiedCount: 0 }),
      },
      Message: { updateOne: async (filter, patch) => { updates.push({ filter, patch }); return { matchedCount: 1 }; } },
      Notification: { updateMany: async (filter, patch) => { notifications.push({ filter, patch }); return { modifiedCount: 0 }; } },
    },
  };
}

test("message search escapes regex metacharacters", () => {
  const raw = "fee.*(2026)?+$";
  const re = new RegExp(escapeRegex(raw), "i");
  assert.equal(re.test(raw), true);
  assert.equal(re.test("feexxxx2026"), false);
});

test("legacy message audiences normalize to the canonical contract", () => {
  assert.equal(normalizeAudienceType("Specific Class"), "Specific Program");
  assert.equal(normalizeAudienceType("Program"), "Specific Program");
  assert.equal(normalizeAudienceType("Cohort"), "Year/Cohort");
  assert.equal(normalizeAudienceType("Not A Real Audience"), "All Students");
});

test("recipient synchronization removes stale receipts and stale portal notifications when an audience becomes empty", async () => {
  const fixture = emptyAudienceModels();
  const req = { models: fixture.models };
  const message = { _id: "65f000000000000000000001", audienceType: "All Students", audienceValue: "—" };
  const recipients = await materializeMessageRecipients(req, message);
  assert.deepEqual(recipients, []);
  assert.equal(fixture.deletions.length, 1);
  assert.deepEqual(fixture.deletions[0], { messageId: message._id });
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0].filter.entityType, "Message");
  assert.equal(fixture.notifications[0].filter.entityId, message._id);
  assert.equal(fixture.notifications[0].patch.$set.isDeleted, true);
});

test("sending to an audience with no eligible users fails closed instead of pretending delivery succeeded", async () => {
  const fixture = emptyAudienceModels();
  let saves = 0;
  const message = {
    _id: "65f000000000000000000002",
    audienceType: "All Students",
    audienceValue: "—",
    channels: { portal: true, email: false },
    status: "Draft",
    sentAt: null,
    scheduleAt: null,
    scheduleClaimedAt: null,
    save: async function () { saves += 1; },
  };
  const result = await dispatchMessage({ models: fixture.models }, message, new Date("2026-08-29T08:00:00Z"));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_recipients");
  assert.equal(message.status, "Failed");
  assert.equal(saves, 1);
});

test("opening a delivered message updates the canonical recipient and delivery stats", async () => {
  const recipientUpdates = [];
  const messageUpdates = [];
  const req = {
    models: {
      MessageRecipient: {
        updateOne: async (filter, patch) => { recipientUpdates.push({ filter, patch }); return { modifiedCount: 1 }; },
        countDocuments: async (filter) => {
          if (filter.status === "Opened") return 1;
          if (filter.status === "Failed") return 0;
          if (filter.status?.$in) return 1;
          return 1;
        },
      },
      Message: { updateOne: async (filter, patch) => { messageUpdates.push({ filter, patch }); return { matchedCount: 1 }; } },
    },
  };
  const ok = await markMessageOpened(req, "65f000000000000000000003", "65f000000000000000000004", new Date("2026-08-29T09:00:00Z"));
  assert.equal(ok, true);
  assert.equal(recipientUpdates[0].patch.$set.status, "Opened");
  assert.equal(Object.hasOwn(recipientUpdates[0].patch.$set, "deliveredAt"), false);
  assert.equal(messageUpdates.length, 1);
  assert.equal(messageUpdates[0].patch.$set.stats.opened, 1);
});
