const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeRegex,
  normalizeEventType,
  normalizeEventAudience,
  activePublicationFilter,
  eventMatchesContext,
  validateEventInput,
  registerForEvent,
  cancelRegistration,
  checkInRegistration,
  buildEventsIcs,
} = require("../src/services/tenant/eventService");

const oid = (suffix) => `507f1f77bcf86cd7994390${suffix}`;
const leanOne = (value) => ({ select() { return this; }, async lean() { return value; } });

test("event search escapes regex metacharacters and legacy values normalize safely", () => {
  assert.equal(escapeRegex("sports.*(final)+"), "sports\\.\\*\\(final\\)\\+");
  assert.equal(normalizeEventType("Unknown"), "General");
  assert.equal(normalizeEventAudience("Students"), "All Students");
  assert.equal(normalizeEventAudience("Specific Class"), "Specific Program");
});

test("event publication filter fails closed to active Published events", () => {
  const now = new Date("2026-08-29T08:00:00.000Z");
  const filter = activePublicationFilter(now);
  assert.equal(filter.status, "Published");
  assert.deepEqual(filter.isDeleted, { $ne: true });
  assert.equal(filter.$and[0].$or[0].endAt.$gt, now);
});

test("event validation requires complete publish dates and authoritative audience targeting", () => {
  const now = new Date("2026-08-29T08:00:00.000Z");
  const missingEnd = validateEventInput({
    title: "Seminar", description: "Details", startAt: new Date("2026-08-30T10:00:00Z"), audienceType: "Open Event",
  }, { publishMode: "Publish Now", now });
  assert.ok(missingEnd.errors.some((e) => /end date\/time/i.test(e)));

  const missingAudience = validateEventInput({
    title: "Seminar", description: "Details", startAt: new Date("2026-08-30T10:00:00Z"), endAt: new Date("2026-08-30T12:00:00Z"), audienceType: "Specific Program", audienceValue: "",
  }, { publishMode: "Publish Now", now });
  assert.ok(missingAudience.errors.some((e) => /Audience value is required/));

  const badSchedule = validateEventInput({
    title: "Seminar", description: "Details", startAt: new Date("2026-08-30T10:00:00Z"), endAt: new Date("2026-08-30T12:00:00Z"), scheduleAt: new Date("2026-08-30T10:00:00Z"), audienceType: "Open Event",
  }, { publishMode: "Schedule", now });
  assert.ok(badSchedule.errors.some((e) => /before the event starts/));
});

test("event audience matching separates student, staff and program contexts", () => {
  assert.equal(eventMatchesContext({ audienceType: "All Students" }, { role: "student" }), true);
  assert.equal(eventMatchesContext({ audienceType: "All Students" }, { role: "staff" }), false);
  assert.equal(eventMatchesContext({ audienceType: "All Staff" }, { role: "student" }), false);
  assert.equal(eventMatchesContext({ audienceType: "Open Event" }, { role: "student" }), true);
  assert.equal(eventMatchesContext({ audienceType: "Open Event" }, { role: "parent" }), false);
});

test("student registration claims event capacity atomically before creating the unique registration", async () => {
  const eventId = oid("11");
  const userId = oid("12");
  let claimQuery;
  let claimUpdate;
  const event = {
    _id: eventId,
    status: "Published",
    audienceType: "All Students",
    audienceValue: "—",
    startAt: new Date("2026-08-30T10:00:00Z"),
    endAt: new Date("2026-08-30T12:00:00Z"),
    capacity: 1,
    stats: { registrations: 0 },
  };
  const Event = {
    async findOne() { return event; },
    async updateOne(query, update) { claimQuery = query; claimUpdate = update; return { modifiedCount: 1 }; },
  };
  let created;
  const EventRegistration = {
    async findOne() { return null; },
    async create(payload) { created = payload; return payload; },
  };
  const result = await registerForEvent({ models: { Event, EventRegistration } }, {
    eventId,
    user: { _id: userId, email: "student@example.test", firstName: "Student" },
    student: { _id: oid("13"), fullName: "Student One" },
    context: { role: "student" },
    now: new Date("2026-08-29T08:00:00Z"),
  });
  assert.equal(result.alreadyRegistered, false);
  assert.equal(claimUpdate.$inc["stats.registrations"], 1);
  assert.ok(claimQuery.$expr.$or.length >= 2);
  assert.equal(created.identityKey, `user:${userId}`);
});

test("student registration refuses capacity when the atomic claim fails", async () => {
  const eventId = oid("21");
  const Event = {
    async findOne() {
      return { _id: eventId, status: "Published", audienceType: "All Students", startAt: new Date("2026-08-30T10:00:00Z"), endAt: new Date("2026-08-30T12:00:00Z") };
    },
    async updateOne() { return { modifiedCount: 0 }; },
  };
  const EventRegistration = { async findOne() { return null; } };
  await assert.rejects(() => registerForEvent({ models: { Event, EventRegistration } }, {
    eventId,
    user: { _id: oid("22"), email: "student@example.test" },
    student: null,
    context: { role: "student" },
    now: new Date("2026-08-29T08:00:00Z"),
  }), /closed or the event is full/);
});

test("registration cancellation is blocked after event start and decrements capacity only on a real cancellation", async () => {
  const eventId = oid("31");
  const userId = oid("32");
  let decremented = 0;
  const Event = {
    findOne() { return leanOne({ _id: eventId }); },
    async updateOne(_q, update) { decremented += Number(update.$inc?.["stats.registrations"] || 0); return {}; },
  };
  const EventRegistration = { async findOneAndUpdate() { return { _id: oid("33") }; } };
  assert.equal(await cancelRegistration({ models: { Event, EventRegistration } }, { eventId, userId, now: new Date() }), true);
  assert.equal(decremented, -1);

  const ClosedEvent = { findOne() { return leanOne(null); }, async updateOne() { throw new Error("must not decrement"); } };
  assert.equal(await cancelRegistration({ models: { Event: ClosedEvent, EventRegistration } }, { eventId, userId, now: new Date() }), false);
});

test("check-in requires a live Published event and increments check-in stats exactly once", async () => {
  const eventId = oid("41");
  const registrationId = oid("42");
  let increment = 0;
  const Event = {
    findOne() { return leanOne({ _id: eventId }); },
    async updateOne(_q, update) { increment += Number(update.$inc?.["stats.checkIns"] || 0); return {}; },
  };
  const EventRegistration = { async findOneAndUpdate() { return { _id: registrationId }; } };
  assert.equal(await checkInRegistration({ models: { Event, EventRegistration } }, { eventId, registrationId, actorId: oid("43"), now: new Date() }), true);
  assert.equal(increment, 1);
});

test("calendar export emits valid ICS data and escapes event text", () => {
  const ics = buildEventsIcs([{
    _id: oid("51"),
    title: "Seminar, Day 1",
    description: "Line one\nLine two",
    venue: "Hall; East",
    startAt: new Date("2026-08-30T10:00:00Z"),
    endAt: new Date("2026-08-30T12:00:00Z"),
  }], { code: "classic" });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Seminar\\, Day 1/);
  assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
  assert.match(ics, /LOCATION:Hall\\; East/);
  assert.match(ics, /END:VCALENDAR/);
});
