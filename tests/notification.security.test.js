const test = require("node:test");
const assert = require("node:assert/strict");
const {
  portalNotificationFilter,
  directNotificationOwnershipFilter,
} = require("../src/services/tenant/notificationService");

test("portal notification filter separates direct targets from untargeted broadcasts", () => {
  const user = { _id: "507f1f77bcf86cd799439011", email: "student@example.test" };
  const now = new Date("2026-08-29T09:00:00.000Z");
  const filter = portalNotificationFilter(user, ["student"], { now });

  const targeting = filter.$and[0].$or;
  assert.deepEqual(targeting[0], { userId: user._id });
  assert.deepEqual(targeting[1], { user: user._id });
  assert.deepEqual(targeting[2], { email: "student@example.test" });

  const broadcast = targeting[3].$and;
  assert.deepEqual(broadcast[0], { $or: [{ userId: null }, { userId: { $exists: false } }] });
  assert.deepEqual(broadcast[1], { $or: [{ user: null }, { user: { $exists: false } }] });
  assert.deepEqual(broadcast[2], { $or: [{ email: null }, { email: "" }, { email: { $exists: false } }] });
  assert.deepEqual(broadcast[3], { audience: { $in: ["all", "student"] } });
});

test("unread portal notification filter excludes already-read records", () => {
  const filter = portalNotificationFilter(
    { _id: "507f1f77bcf86cd799439011", email: "parent@example.test" },
    ["parent"],
    { unreadOnly: true }
  );
  assert.equal(filter.readAt, null);
  assert.deepEqual(filter.isRead, { $ne: true });
});

test("notification read ownership stays direct and never grants broadcast ownership", () => {
  const filter = directNotificationOwnershipFilter({
    _id: "507f1f77bcf86cd799439011",
    email: "staff@example.test",
  });
  assert.equal(filter.$or.length, 3);
  assert.deepEqual(filter.$or[0], { userId: "507f1f77bcf86cd799439011" });
  assert.equal(filter.$or.some((clause) => clause.audience), false);
});
