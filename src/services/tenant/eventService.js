const mongoose = require("mongoose");
const { sendMail } = require("../../utils/mailer");
const {
  STAFF_ROLES,
  announcementMatchesContext,
  normalizeAudienceType: normalizeAnnouncementAudience,
  resolveDirectRecipients: resolveAnnouncementRecipients,
} = require("./announcementService");

const EVENT_TYPES = ["Academic", "Sports", "Seminar", "Workshop", "Conference", "Social", "General"];
const EVENT_AUDIENCES = [
  "All Students",
  "All Staff",
  "Specific Department",
  "Specific Program",
  "Specific Subject",
  "Year/Cohort",
  "Open Event",
];

function str(v) {
  return String(v ?? "").trim();
}

function escapeRegex(v) {
  return str(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(v) {
  return str(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ""));
}

function normalizeEventType(v) {
  const value = str(v);
  return EVENT_TYPES.includes(value) ? value : "General";
}

function normalizeEventAudience(v) {
  const raw = str(v);
  if (raw === "Open Event") return raw;
  const normalized = normalizeAnnouncementAudience(raw);
  return EVENT_AUDIENCES.includes(normalized) ? normalized : "Open Event";
}

function userRoles(user = {}) {
  return Array.isArray(user.roles) ? user.roles.map((r) => str(r).toLowerCase()).filter(Boolean) : [];
}

function isStudentUser(user = {}) {
  return userRoles(user).includes("student");
}

function isStaffUser(user = {}) {
  return userRoles(user).some((r) => STAFF_ROLES.includes(r));
}

function userName(user = {}) {
  return str(user.fullName) || [user.firstName, user.lastName].map(str).filter(Boolean).join(" ") || str(user.email) || "Portal User";
}

function notificationAudienceFor(user = {}) {
  if (isStudentUser(user)) return "student";
  if (isStaffUser(user)) return "staff";
  return "all";
}

function eventMatchesContext(event = {}, context = {}) {
  const type = normalizeEventAudience(event.audienceType);
  if (type === "Open Event") return context.role === "student" || context.role === "staff" || context.role === "admin";
  return announcementMatchesContext(
    { audienceType: type, audienceValue: event.audienceValue },
    context
  );
}

function activePublicationFilter(now = new Date()) {
  return {
    isDeleted: { $ne: true },
    status: "Published",
    $and: [
      {
        $or: [
          { endAt: { $gt: now } },
          { endAt: null, startAt: { $gte: now } },
          { endAt: { $exists: false }, startAt: { $gte: now } },
        ],
      },
    ],
  };
}

function validateEventInput(input = {}, { publishMode = "Publish Now", now = new Date() } = {}) {
  const errors = [];
  const title = str(input.title);
  const description = str(input.description);
  const venue = str(input.venue);
  const startAt = input.startAt instanceof Date ? input.startAt : (input.startAt ? new Date(input.startAt) : null);
  const endAt = input.endAt instanceof Date ? input.endAt : (input.endAt ? new Date(input.endAt) : null);
  const registrationDeadline = input.registrationDeadline instanceof Date
    ? input.registrationDeadline
    : (input.registrationDeadline ? new Date(input.registrationDeadline) : null);
  const scheduleAt = input.scheduleAt instanceof Date ? input.scheduleAt : (input.scheduleAt ? new Date(input.scheduleAt) : null);
  const capacity = Number(input.capacity || 0);

  const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

  if (!title) errors.push("Title is required.");
  if (title.length > 220) errors.push("Title must be 220 characters or fewer.");
  if (!description) errors.push("Description is required.");
  if (description.length > 5000) errors.push("Description must be 5000 characters or fewer.");
  if (venue.length > 240) errors.push("Venue must be 240 characters or fewer.");
  if (!Number.isFinite(capacity) || capacity < 0 || !Number.isInteger(capacity)) errors.push("Capacity must be a whole number of 0 or more.");

  const needsDates = publishMode === "Publish Now" || publishMode === "Schedule";
  if (needsDates && !validDate(startAt)) errors.push("A valid event start date/time is required before publishing or scheduling.");
  if (needsDates && !validDate(endAt)) errors.push("A valid event end date/time is required before publishing or scheduling.");
  if (input.startAt && !validDate(startAt)) errors.push("Start date/time is invalid.");
  if (input.endAt && !validDate(endAt)) errors.push("End date/time is invalid.");
  if (input.registrationDeadline && !validDate(registrationDeadline)) errors.push("Registration deadline is invalid.");
  if (validDate(startAt) && validDate(endAt) && endAt <= startAt) errors.push("Event end time must be after the start time.");
  if (validDate(registrationDeadline) && validDate(startAt) && registrationDeadline > startAt) {
    errors.push("Registration deadline cannot be after the event starts.");
  }
  if (publishMode === "Schedule") {
    if (!validDate(scheduleAt)) errors.push("A valid schedule publish date/time is required.");
    else if (scheduleAt <= now) errors.push("Scheduled publish time must be in the future.");
    if (validDate(scheduleAt) && validDate(startAt) && scheduleAt >= startAt) {
      errors.push("Scheduled publish time must be before the event starts.");
    }
  }
  if (publishMode === "Publish Now" && validDate(endAt) && endAt <= now) {
    errors.push("An event that has already ended cannot be published.");
  }

  const audienceType = normalizeEventAudience(input.audienceType);
  const audienceValue = str(input.audienceValue);
  if (!["All Students", "All Staff", "Open Event"].includes(audienceType) && (!audienceValue || audienceValue === "—")) {
    errors.push("Audience value is required for the selected audience.");
  }

  return {
    errors,
    value: {
      title,
      description,
      venue,
      type: normalizeEventType(input.type),
      priority: str(input.priority) === "Featured" ? "Featured" : "Normal",
      audienceType,
      audienceValue: audienceValue || "—",
      startAt: validDate(startAt) ? startAt : null,
      endAt: validDate(endAt) ? endAt : null,
      registrationDeadline: validDate(registrationDeadline) ? registrationDeadline : null,
      scheduleAt: validDate(scheduleAt) ? scheduleAt : null,
      capacity: Number.isFinite(capacity) && capacity >= 0 ? Math.floor(capacity) : 0,
    },
  };
}

async function resolveEventRecipients(req, event) {
  const pseudo = { audienceType: normalizeEventAudience(event?.audienceType), audienceValue: event?.audienceValue };
  const sets = [];
  if (pseudo.audienceType === "Open Event") {
    sets.push(await resolveAnnouncementRecipients(req, { audienceType: "All Students", audienceValue: "—" }));
    sets.push(await resolveAnnouncementRecipients(req, { audienceType: "All Staff", audienceValue: "—" }));
  } else {
    sets.push(await resolveAnnouncementRecipients(req, pseudo));
  }

  const byId = new Map();
  for (const user of sets.flat()) {
    if (!user?._id || (!isStudentUser(user) && !isStaffUser(user))) continue;
    if (pseudo.audienceType === "All Students" && !isStudentUser(user)) continue;
    if (pseudo.audienceType === "All Staff" && !isStaffUser(user)) continue;
    byId.set(String(user._id), user);
  }
  return [...byId.values()];
}

async function getCommunicationSettings(req) {
  const { Setting } = req.models || {};
  const defaults = { channels: { portal: true, email: false }, defaultSenderName: "", replyToEmail: "" };
  if (!Setting) return defaults;
  const row = await Setting.findOne({ key: "system", isDeleted: { $ne: true } }).lean().catch(() => null);
  const value = row?.value || {};
  return {
    channels: {
      portal: value.channels?.portal !== false,
      email: value.channels?.email === true,
    },
    defaultSenderName: str(value.defaultSenderName),
    replyToEmail: str(value.replyToEmail),
  };
}

async function notifyEventSubscribers(req, event, now = new Date()) {
  const { EventSubscription, Notification } = req.models || {};
  if (!EventSubscription || !Notification || !event?._id) return { notified: 0, emailed: 0, failedEmails: 0 };

  const eligibleUsers = await resolveEventRecipients(req, event);
  const eligibleIds = eligibleUsers.map((u) => u._id).filter(Boolean);
  const subscriptions = eligibleIds.length
    ? await EventSubscription.find({ userId: { $in: eligibleIds }, enabled: true }).lean()
    : [];
  const subByUser = new Map(subscriptions.map((s) => [String(s.userId), s]));
  const recipients = eligibleUsers.filter((u) => subByUser.has(String(u._id)));
  const recipientIds = recipients.map((u) => u._id);

  const staleFilter = {
    entityType: "Event",
    entityId: event._id,
    entityAction: "event_published",
    isDeleted: { $ne: true },
  };
  if (recipientIds.length) staleFilter.userId = { $nin: recipientIds };
  await Notification.updateMany(staleFilter, { $set: { isDeleted: true, deletedAt: now } }).catch(() => {});

  let notified = 0;
  for (const user of recipients) {
    const sub = subByUser.get(String(user._id));
    if (sub?.portal === false) continue;
    await Notification.updateOne(
      { entityType: "Event", entityId: event._id, entityAction: "event_published", userId: user._id },
      {
        $set: {
          audience: notificationAudienceFor(user),
          title: `Event: ${str(event.title).slice(0, 130)}`,
          message: str(event.description).slice(0, 5000),
          type: event.priority === "Featured" ? "success" : "info",
          url: isStudentUser(user) ? "/student/events" : "/staff/notifications",
          isRead: false,
          readAt: null,
          isDeleted: false,
          deletedAt: null,
          deliverAt: now,
          updatedBy: req.user?.userId || req.user?._id || null,
        },
        $setOnInsert: { createdBy: req.user?.userId || req.user?._id || null },
      },
      { upsert: true }
    );
    notified += 1;
  }

  const settings = await getCommunicationSettings(req);
  let emailed = 0;
  let failedEmails = 0;
  if (settings.channels.email) {
    for (const user of recipients) {
      const sub = subByUser.get(String(user._id));
      if (!sub?.email || !str(user.email)) continue;
      try {
        const when = event.startAt ? new Date(event.startAt).toLocaleString("en-GB") : "See the portal for details";
        await sendMail({
          to: str(user.email).toLowerCase(),
          subject: `New event: ${str(event.title)}`,
          text: `${str(event.title)}\n${when}\n${str(event.venue)}\n\n${str(event.description)}`,
          html: `<h2>${escapeHtml(event.title)}</h2><p><strong>When:</strong> ${escapeHtml(when)}</p><p><strong>Venue:</strong> ${escapeHtml(event.venue || "TBA")}</p><p>${escapeHtml(event.description)}</p>`,
          replyTo: settings.replyToEmail || undefined,
          fromName: settings.defaultSenderName || undefined,
        });
        emailed += 1;
      } catch {
        failedEmails += 1;
      }
    }
  }

  return { notified, emailed, failedEmails };
}

async function activateEvent(req, event, now = new Date()) {
  const { Event } = req.models || {};
  if (!Event || !event?._id) throw new Error("Event model is unavailable.");

  const endAt = event.endAt ? new Date(event.endAt) : null;
  if (endAt && !Number.isNaN(endAt.getTime()) && endAt <= now) {
    throw new Error("An event that has already ended cannot be published.");
  }
  if (!event.startAt) throw new Error("Event start date/time is required before publishing.");

  await Event.updateOne(
    { _id: event._id, isDeleted: { $ne: true } },
    {
      $set: {
        status: "Published",
        scheduleAt: null,
        scheduleClaimedAt: null,
        publishedAt: event.publishedAt || now,
        updatedBy: req.user?.userId || req.user?._id || event.updatedBy || null,
      },
    }
  );
  const current = await Event.findById(event._id).lean();
  await notifyEventSubscribers(req, current, now);
  return current;
}

async function processDueEvents(req, now = new Date()) {
  const { Event } = req.models || {};
  if (!Event) return 0;
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  let processed = 0;

  while (processed < 100) {
    const claimed = await Event.findOneAndUpdate(
      {
        isDeleted: { $ne: true },
        status: "Scheduled",
        scheduleAt: { $lte: now },
        $or: [
          { scheduleClaimedAt: null },
          { scheduleClaimedAt: { $exists: false } },
          { scheduleClaimedAt: { $lt: staleBefore } },
        ],
      },
      { $set: { scheduleClaimedAt: now } },
      { sort: { scheduleAt: 1, _id: 1 }, new: true }
    );
    if (!claimed) break;

    try {
      const endAt = claimed.endAt ? new Date(claimed.endAt) : null;
      if (!claimed.startAt || (endAt && endAt <= now)) {
        await Event.updateOne(
          { _id: claimed._id },
          { $set: { status: "Draft", scheduleAt: null, scheduleClaimedAt: null } }
        );
      } else {
        await activateEvent(req, claimed, now);
      }
      processed += 1;
    } catch (err) {
      await Event.updateOne({ _id: claimed._id }, { $set: { scheduleClaimedAt: null } }).catch(() => {});
      throw err;
    }
  }
  return processed;
}

async function findVisibleEvents(req, context, { limit = 100, now = new Date() } = {}) {
  const { Event } = req.models || {};
  if (!Event) return [];
  const rows = await Event.find(activePublicationFilter(now))
    .sort({ priority: -1, startAt: 1, createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .lean();
  return rows.filter((event) => eventMatchesContext(event, context));
}

async function recordEventViews(req, eventIds = [], userId, now = new Date()) {
  const { Event, EventView } = req.models || {};
  if (!Event || !EventView || !isValidId(userId)) return 0;
  let uniqueViews = 0;
  for (const eventId of [...new Set((eventIds || []).map(String).filter(isValidId))]) {
    const result = await EventView.updateOne(
      { eventId, userId },
      {
        $set: { lastViewedAt: now },
        $inc: { viewCount: 1 },
        $setOnInsert: { eventId, userId, firstViewedAt: now },
      },
      { upsert: true }
    );
    if (result.upsertedCount) {
      uniqueViews += 1;
      await Event.updateOne({ _id: eventId }, { $inc: { "stats.views": 1 } });
    }
  }
  return uniqueViews;
}

function registrationIdentity(user, student) {
  if (user?._id) return `user:${String(user._id)}`;
  if (student?._id) return `student:${String(student._id)}`;
  const email = str(user?.email || student?.email).toLowerCase();
  return email ? `email:${email}` : "";
}

async function getRegistrationMap(req, eventIds, userId) {
  const { EventRegistration } = req.models || {};
  if (!EventRegistration || !userId || !eventIds?.length) return new Map();
  const rows = await EventRegistration.find({ eventId: { $in: eventIds }, userId, status: { $ne: "Cancelled" } }).lean();
  return new Map(rows.map((r) => [String(r.eventId), r]));
}

async function registerForEvent(req, { eventId, user, student, context, now = new Date() }) {
  const { Event, EventRegistration } = req.models || {};
  if (!Event || !EventRegistration) throw new Error("Event registration is unavailable.");
  if (!isValidId(eventId)) throw new Error("Invalid event.");
  const event = await Event.findOne({ _id: eventId, isDeleted: { $ne: true } });
  if (!event || event.status !== "Published") throw new Error("This event is not open for registration.");
  if (!eventMatchesContext(event, context)) throw new Error("This event is not available to your audience.");
  if (!event.startAt || new Date(event.startAt) <= now) throw new Error("Registration is closed because the event has started.");
  if (event.endAt && new Date(event.endAt) <= now) throw new Error("This event has ended.");
  if (event.registrationDeadline && new Date(event.registrationDeadline) <= now) throw new Error("The registration deadline has passed.");

  const identityKey = registrationIdentity(user, student);
  if (!identityKey) throw new Error("Your account could not be linked to an event registration.");
  const existing = await EventRegistration.findOne({ eventId: event._id, identityKey });
  if (existing && existing.status !== "Cancelled") return { registration: existing, alreadyRegistered: true };

  const claim = await Event.updateOne(
    {
      _id: event._id,
      isDeleted: { $ne: true },
      status: "Published",
      startAt: { $gt: now },
      $or: [
        { registrationDeadline: null },
        { registrationDeadline: { $exists: false } },
        { registrationDeadline: { $gt: now } },
      ],
      $expr: {
        $or: [
          { $lte: [{ $ifNull: ["$capacity", 0] }, 0] },
          { $lt: [{ $ifNull: ["$stats.registrations", 0] }, { $ifNull: ["$capacity", 0] }] },
        ],
      },
    },
    { $inc: { "stats.registrations": 1 } }
  );
  if (!claim.modifiedCount) throw new Error("Registration is closed or the event is full.");

  try {
    const payload = {
      eventId: event._id,
      userId: user?._id || null,
      studentId: student?._id || null,
      identityKey,
      name: userName({ ...student, ...user, fullName: student?.fullName || user?.fullName }),
      email: str(user?.email || student?.email).toLowerCase(),
      role: "Student",
      status: "Registered",
      registeredAt: now,
      checkedInAt: null,
      cancelledAt: null,
      createdBy: user?._id || null,
      updatedBy: user?._id || null,
    };

    let registration;
    if (existing) {
      const updated = await EventRegistration.findOneAndUpdate(
        { _id: existing._id, status: "Cancelled" },
        { $set: payload },
        { new: true }
      );
      if (!updated) {
        await Event.updateOne({ _id: event._id }, { $inc: { "stats.registrations": -1 } });
        registration = await EventRegistration.findOne({ eventId: event._id, identityKey });
        return { registration, alreadyRegistered: true };
      }
      registration = updated;
    } else {
      registration = await EventRegistration.create(payload);
    }
    return { registration, alreadyRegistered: false };
  } catch (err) {
    await Event.updateOne({ _id: event._id }, { $inc: { "stats.registrations": -1 } }).catch(() => {});
    if (err?.code === 11000) {
      const registration = await EventRegistration.findOne({ eventId: event._id, identityKey });
      return { registration, alreadyRegistered: true };
    }
    throw err;
  }
}

async function cancelRegistration(req, { eventId, userId, now = new Date() }) {
  const { Event, EventRegistration } = req.models || {};
  if (!Event || !EventRegistration || !isValidId(eventId) || !isValidId(userId)) return false;
  const event = await Event.findOne({
    _id: eventId,
    isDeleted: { $ne: true },
    status: "Published",
    startAt: { $gt: now },
  }).select("_id").lean();
  if (!event) return false;
  const row = await EventRegistration.findOneAndUpdate(
    { eventId, userId, status: "Registered" },
    { $set: { status: "Cancelled", cancelledAt: now, updatedBy: userId } },
    { new: true }
  );
  if (!row) return false;
  await Event.updateOne({ _id: eventId, "stats.registrations": { $gt: 0 } }, { $inc: { "stats.registrations": -1 } });
  return true;
}

async function checkInRegistration(req, { eventId, registrationId, actorId, now = new Date() }) {
  const { Event, EventRegistration } = req.models || {};
  if (!Event || !EventRegistration || !isValidId(eventId) || !isValidId(registrationId)) return false;
  const event = await Event.findOne({
    _id: eventId,
    isDeleted: { $ne: true },
    status: "Published",
    $or: [{ endAt: null }, { endAt: { $exists: false } }, { endAt: { $gt: now } }],
  }).select("_id").lean();
  if (!event) return false;
  const row = await EventRegistration.findOneAndUpdate(
    { _id: registrationId, eventId, status: "Registered" },
    { $set: { status: "Checked In", checkedInAt: now, updatedBy: actorId || null } },
    { new: true }
  );
  if (!row) return false;
  await Event.updateOne({ _id: eventId }, { $inc: { "stats.checkIns": 1 } });
  return true;
}

async function syncEventRegistrationStats(req, eventId) {
  const { Event, EventRegistration } = req.models || {};
  if (!Event || !EventRegistration || !eventId) return null;
  const [registrations, checkIns] = await Promise.all([
    EventRegistration.countDocuments({ eventId, status: { $in: ["Registered", "Checked In", "Absent"] } }),
    EventRegistration.countDocuments({ eventId, status: "Checked In" }),
  ]);
  await Event.updateOne({ _id: eventId }, { $set: { "stats.registrations": registrations, "stats.checkIns": checkIns } });
  return { registrations, checkIns };
}

async function remindRegistrants(req, event, now = new Date()) {
  const { EventRegistration, Notification } = req.models || {};
  if (!EventRegistration || !event?._id) return { reminded: 0, emailed: 0, failedEmails: 0 };
  const rows = await EventRegistration.find({ eventId: event._id, status: { $in: ["Registered", "Checked In"] } }).lean();
  if (!rows.length) return { reminded: 0, emailed: 0, failedEmails: 0 };

  const settings = await getCommunicationSettings(req);
  const nowText = event.startAt ? new Date(event.startAt).toLocaleString("en-GB") : "See event details";
  let reminded = 0;
  if (settings.channels.portal && Notification) {
    const ops = rows.filter((r) => r.userId).map((r) => ({
      updateOne: {
        filter: { entityType: "Event", entityId: event._id, entityAction: "event_reminder", userId: r.userId },
        update: {
          $set: {
            audience: str(r.role).toLowerCase() === "student" ? "student" : "staff",
            title: `Reminder: ${str(event.title).slice(0, 128)}`,
            message: `${nowText}${event.venue ? ` • ${str(event.venue)}` : ""}`,
            type: "info",
            url: str(r.role).toLowerCase() === "student" ? "/student/events" : "/staff/notifications",
            isRead: false,
            readAt: null,
            isDeleted: false,
            deletedAt: null,
            deliverAt: now,
            updatedBy: req.user?.userId || req.user?._id || null,
          },
          $setOnInsert: { createdBy: req.user?.userId || req.user?._id || null },
        },
        upsert: true,
      },
    }));
    if (ops.length) await Notification.bulkWrite(ops, { ordered: false });
    reminded = ops.length;
  }

  let emailed = 0;
  let failedEmails = 0;
  if (settings.channels.email) {
    for (const row of rows) {
      if (!row.email) continue;
      try {
        await sendMail({
          to: row.email,
          subject: `Event reminder: ${str(event.title)}`,
          text: `${str(event.title)}\n${nowText}\n${str(event.venue)}\n\n${str(event.description)}`,
          html: `<h2>${escapeHtml(event.title)}</h2><p><strong>When:</strong> ${escapeHtml(nowText)}</p><p><strong>Venue:</strong> ${escapeHtml(event.venue || "TBA")}</p><p>${escapeHtml(event.description)}</p>`,
          replyTo: settings.replyToEmail || undefined,
          fromName: settings.defaultSenderName || undefined,
        });
        emailed += 1;
      } catch {
        failedEmails += 1;
      }
    }
  }

  await EventRegistration.updateMany(
    { _id: { $in: rows.map((r) => r._id) } },
    { $inc: { reminderCount: 1 }, $set: { lastRemindedAt: now } }
  );
  return { reminded, emailed, failedEmails };
}

async function cancelEventAndNotify(req, event, now = new Date()) {
  const { Event, EventRegistration, Notification } = req.models || {};
  if (!Event || !event?._id) return 0;
  await Event.updateOne(
    { _id: event._id, isDeleted: { $ne: true } },
    { $set: { status: "Cancelled", scheduleAt: null, scheduleClaimedAt: null, updatedBy: req.user?.userId || req.user?._id || null } }
  );
  if (!EventRegistration || !Notification) return 0;
  const rows = await EventRegistration.find({ eventId: event._id, status: { $in: ["Registered", "Checked In"] }, userId: { $ne: null } }).lean();
  if (!rows.length) return 0;
  await Notification.bulkWrite(rows.map((r) => ({
    updateOne: {
      filter: { entityType: "Event", entityId: event._id, entityAction: "event_cancelled", userId: r.userId },
      update: {
        $set: {
          audience: str(r.role).toLowerCase() === "student" ? "student" : "staff",
          title: `Event cancelled: ${str(event.title).slice(0, 120)}`,
          message: "This event has been cancelled. Check the portal for updated information.",
          type: "warning",
          url: str(r.role).toLowerCase() === "student" ? "/student/events" : "/staff/notifications",
          isRead: false,
          readAt: null,
          isDeleted: false,
          deletedAt: null,
          deliverAt: now,
          updatedBy: req.user?.userId || req.user?._id || null,
        },
        $setOnInsert: { createdBy: req.user?.userId || req.user?._id || null },
      },
      upsert: true,
    },
  })), { ordered: false });
  return rows.length;
}

async function toggleEventSubscription(req, userId) {
  const { EventSubscription } = req.models || {};
  if (!EventSubscription || !isValidId(userId)) throw new Error("Event alerts are unavailable.");
  const existing = await EventSubscription.findOne({ userId });
  if (!existing) {
    const created = await EventSubscription.create({ userId, enabled: true, portal: true, email: false, createdBy: userId, updatedBy: userId });
    return created;
  }
  existing.enabled = !existing.enabled;
  existing.updatedBy = userId;
  await existing.save();
  return existing;
}

function icsEscape(v) {
  return str(v).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildEventsIcs(events = [], tenant = {}) {
  const now = icsDate(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Classic Academy//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) {
    if (!event?._id || !event.startAt) continue;
    const start = icsDate(event.startAt);
    const end = icsDate(event.endAt || new Date(new Date(event.startAt).getTime() + 60 * 60 * 1000));
    if (!start || !end) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:event-${String(event._id)}@${icsEscape(tenant?.subdomain || tenant?.code || "classic-academy")}`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(event.description)}`,
      `LOCATION:${icsEscape(event.venue || "")}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

module.exports = {
  EVENT_TYPES,
  EVENT_AUDIENCES,
  str,
  escapeRegex,
  normalizeEventType,
  normalizeEventAudience,
  activePublicationFilter,
  eventMatchesContext,
  validateEventInput,
  resolveEventRecipients,
  notifyEventSubscribers,
  activateEvent,
  processDueEvents,
  findVisibleEvents,
  recordEventViews,
  registrationIdentity,
  getRegistrationMap,
  registerForEvent,
  cancelRegistration,
  checkInRegistration,
  syncEventRegistrationStats,
  remindRegistrants,
  cancelEventAndNotify,
  toggleEventSubscription,
  buildEventsIcs,
};
