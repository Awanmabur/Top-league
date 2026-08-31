const mongoose = require("mongoose");
const { normalizeEventAudience, normalizeEventType } = require("../../src/services/tenant/eventService");

function str(v) {
  return String(v ?? "").trim();
}

function identityForLegacy(row = {}) {
  if (row.userId && mongoose.Types.ObjectId.isValid(String(row.userId))) return `user:${String(row.userId)}`;
  const email = str(row.email).toLowerCase();
  if (email) return `email:${email}`;
  if (row._id) return `legacy:${String(row._id)}`;
  return "";
}

async function migrateEvents(models = {}) {
  const { Event, EventRegistration } = models;
  if (!Event || !EventRegistration) return { scanned: 0, normalized: 0, registrationsMigrated: 0, statsSynced: 0 };

  const events = await Event.find({}).select(
    "_id type audienceType audienceValue status scheduleAt scheduleClaimedAt publishedAt createdAt capacity stats attendance"
  );
  let normalized = 0;
  let registrationsMigrated = 0;
  let statsSynced = 0;

  for (const event of events) {
    const patch = {};
    const type = normalizeEventType(event.type);
    const audienceType = normalizeEventAudience(event.audienceType);
    if (type !== event.type) patch.type = type;
    if (audienceType !== event.audienceType) patch.audienceType = audienceType;
    if (!Number.isFinite(Number(event.capacity)) || Number(event.capacity) < 0) patch.capacity = 0;
    if (event.status === "Scheduled" && !event.scheduleAt) {
      patch.status = "Draft";
      patch.scheduleAt = null;
    }
    if (event.status === "Published" && !event.publishedAt) patch.publishedAt = event.createdAt || new Date();
    if (event.scheduleClaimedAt) patch.scheduleClaimedAt = null;
    if (Object.keys(patch).length) {
      await Event.updateOne({ _id: event._id }, { $set: patch });
      normalized += 1;
    }

    const attendance = Array.isArray(event.attendance) ? event.attendance : [];
    const ops = attendance
      .map((row) => ({ row, identityKey: identityForLegacy(row) }))
      .filter((x) => x.identityKey)
      .map(({ row, identityKey }) => ({
        updateOne: {
          filter: { eventId: event._id, identityKey },
          update: {
            $setOnInsert: {
              eventId: event._id,
              identityKey,
              userId: row.userId || null,
              studentId: null,
              createdBy: null,
            },
            $set: {
              name: str(row.name),
              email: str(row.email).toLowerCase(),
              role: str(row.role) || "Student",
              status: ["Registered", "Checked In", "Absent"].includes(row.status) ? row.status : "Registered",
              registeredAt: row.registeredAt || event.createdAt || new Date(),
              checkedInAt: row.checkedInAt || null,
            },
          },
          upsert: true,
        },
      }));
    if (ops.length) {
      await EventRegistration.bulkWrite(ops, { ordered: false });
      registrationsMigrated += ops.length;
    }

    const [registrations, checkIns] = await Promise.all([
      EventRegistration.countDocuments({ eventId: event._id, status: { $in: ["Registered", "Checked In", "Absent"] } }),
      EventRegistration.countDocuments({ eventId: event._id, status: "Checked In" }),
    ]);
    if (Number(event.stats?.registrations || 0) !== registrations || Number(event.stats?.checkIns || 0) !== checkIns) {
      await Event.updateOne(
        { _id: event._id },
        { $set: { "stats.registrations": registrations, "stats.checkIns": checkIns } }
      );
      statsSynced += 1;
    }
  }

  return { scanned: events.length, normalized, registrationsMigrated, statsSynced };
}

module.exports = { identityForLegacy, migrateEvents };
