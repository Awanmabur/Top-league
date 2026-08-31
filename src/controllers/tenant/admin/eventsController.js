const mongoose = require("mongoose");
const {
  escapeRegex,
  normalizeEventAudience,
  normalizeEventType,
  validateEventInput,
  activateEvent,
  processDueEvents,
  notifyEventSubscribers,
  remindRegistrants,
  cancelEventAndNotify,
  checkInRegistration,
} = require("../../../services/tenant/eventService");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const str = (v) => String(v ?? "").trim();

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function serializeRegistration(row) {
  return {
    id: String(row._id),
    user: row.name || "",
    email: row.email || "",
    role: row.role || "",
    status: row.status || "Registered",
    registeredAt: formatDateTime(row.registeredAt),
    checkedInAt: formatDateTime(row.checkedInAt),
  };
}

function serializeEvent(doc, attendanceRows = []) {
  return {
    id: String(doc._id),
    title: doc.title || "",
    type: doc.type || "General",
    audType: doc.audienceType || "Open Event",
    audVal: doc.audienceValue || "—",
    venue: doc.venue || "",
    startAt: formatDateTime(doc.startAt),
    endAt: formatDateTime(doc.endAt),
    startAtRaw: doc.startAt ? new Date(doc.startAt).toISOString().slice(0, 16) : "",
    endAtRaw: doc.endAt ? new Date(doc.endAt).toISOString().slice(0, 16) : "",
    scheduleAtRaw: doc.scheduleAt ? new Date(doc.scheduleAt).toISOString().slice(0, 16) : "",
    registrationDeadlineRaw: doc.registrationDeadline ? new Date(doc.registrationDeadline).toISOString().slice(0, 16) : "",
    status: doc.status || "Draft",
    featured: doc.priority === "Featured",
    description: doc.description || "",
    capacity: Number(doc.capacity || 0),
    stats: {
      views: Number(doc.stats?.views || 0),
      registrations: Number(doc.stats?.registrations || 0),
      checkIns: Number(doc.stats?.checkIns || 0),
      capacity: Number(doc.capacity || 0),
    },
    attendance: attendanceRows.map(serializeRegistration),
  };
}

function serializeTemplate(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "",
    title: doc.title || "",
    description: doc.description || "",
    type: doc.type || "General",
    priority: doc.priority || "Normal",
    audienceType: doc.audienceType || "Open Event",
    audienceValue: doc.audienceValue || "—",
    venue: doc.venue || "",
    durationMinutes: Number(doc.durationMinutes || 60),
    capacity: Number(doc.capacity || 0),
  };
}

function computeKpis(list = []) {
  const now = new Date();
  return {
    published: list.filter((x) => x.status === "Published").length,
    scheduled: list.filter((x) => x.status === "Scheduled").length,
    drafts: list.filter((x) => x.status === "Draft").length,
    upcoming: list.filter((x) => {
      if (!x.startAtRaw || x.status === "Cancelled") return false;
      const d = new Date(x.startAtRaw);
      return !Number.isNaN(d.getTime()) && d > now;
    }).length,
  };
}


function buildEventQuery(queryParams = {}) {
  const q = str(queryParams.q);
  const status = str(queryParams.status || "all");
  const type = str(queryParams.type || "all");
  const audience = str(queryParams.audience || "all");
  const mongo = { isDeleted: { $ne: true } };

  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { title: re },
      { description: re },
      { type: re },
      { audienceType: re },
      { audienceValue: re },
      { venue: re },
      { status: re },
    ];
  }
  if (status !== "all") mongo.status = status;
  if (type !== "all") mongo.type = normalizeEventType(type);
  if (audience !== "all") mongo.audienceType = normalizeEventAudience(audience);

  return { mongo, clean: { q, status, type, audience } };
}

function eventInputFromBody(body = {}) {
  return {
    title: str(body.title),
    description: str(body.description),
    type: str(body.type || "General"),
    priority: str(body.priority || "Normal"),
    audienceType: str(body.audienceType || "Open Event"),
    audienceValue: str(body.audienceValue || "—"),
    venue: str(body.venue || ""),
    startAt: asDate(body.startAt),
    endAt: asDate(body.endAt),
    registrationDeadline: asDate(body.registrationDeadline),
    capacity: body.capacity,
    scheduleAt: asDate(body.scheduleAt),
  };
}

function statusForPublishMode(mode) {
  if (mode === "Publish Now") return "Published";
  if (mode === "Schedule") return "Scheduled";
  return "Draft";
}

function csvCell(value) {
  let s = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

module.exports = {
  index: async (req, res) => {
    const { Event, EventRegistration, EventTemplate } = req.models;
    await processDueEvents(req, new Date()).catch((err) => console.error("EVENT DUE PROCESS:", err?.message || err));

    const { mongo, clean } = buildEventQuery(req.query);
    const events = await Event.find(mongo).sort({ priority: -1, startAt: 1, createdAt: -1 }).lean();
    const ids = events.map((e) => e._id);
    const registrations = EventRegistration && ids.length
      ? await EventRegistration.find({ eventId: { $in: ids }, status: { $ne: "Cancelled" } }).sort({ registeredAt: 1 }).lean()
      : [];
    const byEvent = new Map();
    for (const row of registrations) {
      const key = String(row.eventId);
      if (!byEvent.has(key)) byEvent.set(key, []);
      byEvent.get(key).push(row);
    }
    const data = events.map((event) => serializeEvent(event, byEvent.get(String(event._id)) || []));
    const templates = EventTemplate
      ? await EventTemplate.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).lean()
      : [];

    return res.render("tenant/events/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      events: data,
      templates: templates.map(serializeTemplate),
      kpis: computeKpis(data),
      query: clean,
    });
  },

  create: async (req, res) => {
    const { Event } = req.models;
    const publishMode = str(req.body.publishMode || "Publish Now");
    const checked = validateEventInput(eventInputFromBody(req.body), { publishMode, now: new Date() });
    if (checked.errors.length) {
      req.flash?.("error", checked.errors[0]);
      return res.redirect("/admin/events");
    }

    const status = statusForPublishMode(publishMode);
    const item = await Event.create({
      ...checked.value,
      status,
      scheduleAt: status === "Scheduled" ? checked.value.scheduleAt : null,
      scheduleClaimedAt: null,
      publishedAt: status === "Published" ? new Date() : null,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });
    if (status === "Published") await notifyEventSubscribers(req, item, new Date()).catch(() => {});

    req.flash?.("success", status === "Scheduled" ? "Event scheduled successfully." : status === "Draft" ? "Event saved as draft." : "Event published successfully.");
    return res.redirect("/admin/events");
  },

  update: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid event ID.");
      return res.redirect("/admin/events");
    }
    const item = await Event.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) {
      req.flash?.("error", "Event not found.");
      return res.redirect("/admin/events");
    }

    const publishMode = str(req.body.publishMode || "Publish Now");
    const checked = validateEventInput(eventInputFromBody(req.body), { publishMode, now: new Date() });
    if (checked.errors.length) {
      req.flash?.("error", checked.errors[0]);
      return res.redirect("/admin/events");
    }

    const status = statusForPublishMode(publishMode);
    Object.assign(item, checked.value);
    item.status = status;
    item.scheduleAt = status === "Scheduled" ? checked.value.scheduleAt : null;
    item.scheduleClaimedAt = null;
    item.publishedAt = status === "Published" ? (item.publishedAt || new Date()) : null;
    item.updatedBy = actorUserId(req);
    await item.save();
    if (status === "Published") await notifyEventSubscribers(req, item, new Date()).catch(() => {});

    req.flash?.("success", "Event updated successfully.");
    return res.redirect("/admin/events");
  },

  publish: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");
    const item = await Event.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) {
      req.flash?.("error", "Event not found.");
      return res.redirect("/admin/events");
    }
    const checked = validateEventInput(item.toObject(), { publishMode: "Publish Now", now: new Date() });
    if (checked.errors.length) {
      req.flash?.("error", checked.errors[0]);
      return res.redirect("/admin/events");
    }
    await activateEvent(req, item, new Date());
    req.flash?.("success", "Event published successfully.");
    return res.redirect("/admin/events");
  },

  cancel: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");
    const item = await Event.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (item) {
      const notified = await cancelEventAndNotify(req, item, new Date());
      req.flash?.("success", `Event cancelled${notified ? `; ${notified} registered attendee(s) notified` : ""}.`);
    }
    return res.redirect("/admin/events");
  },

  delete: async (req, res) => {
    const { Event, Notification } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");
    await Event.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), status: "Cancelled", scheduleAt: null, scheduleClaimedAt: null, updatedBy: actorUserId(req) } }
    );
    if (Notification) {
      await Notification.updateMany(
        { entityType: "Event", entityId: req.params.id, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date() } }
      ).catch(() => {});
    }
    req.flash?.("success", "Event deleted successfully.");
    return res.redirect("/admin/events");
  },

  bulkAction: async (req, res) => {
    const { Event } = req.models;
    const ids = String(req.body.ids || "").split(",").map((x) => x.trim()).filter(isValidId);
    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/events");

    if (["feature", "unfeature"].includes(action)) {
      await Event.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        { $set: { priority: action === "feature" ? "Featured" : "Normal", updatedBy: actorUserId(req) } }
      );
      req.flash?.("success", `${ids.length} event(s) updated.`);
      return res.redirect("/admin/events");
    }

    const rows = await Event.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
    let changed = 0;
    let skipped = 0;
    for (const item of rows) {
      if (action === "publish") {
        const checked = validateEventInput(item.toObject(), { publishMode: "Publish Now", now: new Date() });
        if (checked.errors.length) { skipped += 1; continue; }
        await activateEvent(req, item, new Date());
        changed += 1;
      } else if (action === "cancel") {
        await cancelEventAndNotify(req, item, new Date());
        changed += 1;
      }
    }
    if (changed) req.flash?.("success", `${changed} event(s) updated successfully.`);
    if (skipped) req.flash?.("error", `${skipped} event(s) could not be published because their dates are invalid or already ended.`);
    return res.redirect("/admin/events");
  },

  remind: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");
    const now = new Date();
    await processDueEvents(req, now).catch(() => {});
    const item = await Event.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!item || item.status !== "Published" || (item.endAt && new Date(item.endAt) <= now)) {
      req.flash?.("error", "Only active published events can send reminders.");
      return res.redirect(`/admin/events?view=attendance&event=${encodeURIComponent(req.params.id)}`);
    }
    const result = await remindRegistrants(req, item, now);
    if (!result.reminded && !result.emailed && !result.failedEmails) req.flash?.("error", "This event has no registered attendees to remind.");
    else req.flash?.("success", `Reminder processed: ${result.reminded} portal notification(s), ${result.emailed} email(s) sent${result.failedEmails ? `, ${result.failedEmails} email failure(s)` : ""}.`);
    return res.redirect(`/admin/events?view=attendance&event=${encodeURIComponent(req.params.id)}`);
  },

  checkIn: async (req, res) => {
    const ok = await checkInRegistration(req, {
      eventId: req.params.id,
      registrationId: req.params.registrationId,
      actorId: actorUserId(req),
      now: new Date(),
    });
    req.flash?.(ok ? "success" : "error", ok ? "Attendee checked in." : "Attendee could not be checked in.");
    return res.redirect(`/admin/events?view=attendance&event=${encodeURIComponent(req.params.id)}`);
  },

  exportCsv: async (req, res) => {
    const { Event, EventRegistration } = req.models;
    const { mongo } = buildEventQuery(req.query);
    const events = await Event.find(mongo).sort({ startAt: 1, createdAt: -1 }).lean();
    const eventIds = events.map((e) => e._id);
    const regs = EventRegistration && eventIds.length
      ? await EventRegistration.find({ eventId: { $in: eventIds }, status: { $ne: "Cancelled" } }).lean()
      : [];
    const regCount = new Map();
    const checkCount = new Map();
    for (const r of regs) {
      const key = String(r.eventId);
      regCount.set(key, (regCount.get(key) || 0) + 1);
      if (r.status === "Checked In") checkCount.set(key, (checkCount.get(key) || 0) + 1);
    }
    const rows = [["Title", "Type", "Audience", "Audience Value", "Venue", "Start", "End", "Status", "Capacity", "Registrations", "Check-ins"]];
    for (const e of events) {
      const key = String(e._id);
      rows.push([
        e.title, e.type, e.audienceType, e.audienceValue, e.venue,
        e.startAt ? new Date(e.startAt).toISOString() : "",
        e.endAt ? new Date(e.endAt).toISOString() : "",
        e.status, Number(e.capacity || 0), regCount.get(key) || 0, checkCount.get(key) || 0,
      ]);
    }
    const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="events-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  },

  createTemplate: async (req, res) => {
    const { EventTemplate } = req.models;
    if (!EventTemplate) return res.redirect("/admin/events");
    const name = str(req.body.name);
    const title = str(req.body.title);
    const description = str(req.body.description);
    if (!name || !title || !description) {
      req.flash?.("error", "Template name, title and description are required.");
      return res.redirect("/admin/events");
    }
    const audienceType = normalizeEventAudience(req.body.audienceType);
    const audienceValue = str(req.body.audienceValue || "—");
    if (!["All Students", "All Staff", "Open Event"].includes(audienceType) && (!audienceValue || audienceValue === "—")) {
      req.flash?.("error", "Audience value is required for the selected template audience.");
      return res.redirect("/admin/events");
    }
    const durationMinutes = Math.min(Math.max(Math.floor(Number(req.body.durationMinutes || 60) || 60), 0), 10080);
    const capacity = Math.max(Math.floor(Number(req.body.capacity || 0) || 0), 0);
    await EventTemplate.create({
      name: name.slice(0, 120),
      title: title.slice(0, 220),
      description: description.slice(0, 5000),
      type: normalizeEventType(req.body.type),
      priority: str(req.body.priority) === "Featured" ? "Featured" : "Normal",
      audienceType,
      audienceValue: audienceValue.slice(0, 180),
      venue: str(req.body.venue).slice(0, 240),
      durationMinutes,
      capacity,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });
    req.flash?.("success", "Event template created.");
    return res.redirect("/admin/events");
  },

  deleteTemplate: async (req, res) => {
    const { EventTemplate } = req.models;
    if (EventTemplate && isValidId(req.params.id)) {
      await EventTemplate.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, isActive: false, deletedAt: new Date(), updatedBy: actorUserId(req) } }
      );
      req.flash?.("success", "Event template deleted.");
    }
    return res.redirect("/admin/events");
  },
};
