const mongoose = require("mongoose");

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

function serializeEvent(doc) {
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
    attendance: Array.isArray(doc.attendance)
      ? doc.attendance.map((r) => ({
          id: String(r._id),
          user: r.name || "",
          email: r.email || "",
          role: r.role || "",
          status: r.status || "Absent",
          registeredAt: formatDateTime(r.registeredAt),
          checkedInAt: formatDateTime(r.checkedInAt),
        }))
      : [],
  };
}

function computeKpis(list = []) {
  const now = new Date();
  return {
    published: list.filter((x) => x.status === "Published").length,
    scheduled: list.filter((x) => x.status === "Scheduled").length,
    drafts: list.filter((x) => x.status === "Draft").length,
    upcoming: list.filter((x) => {
      if (!x.startAtRaw) return false;
      const d = new Date(x.startAtRaw);
      return !Number.isNaN(d.getTime()) && d > now;
    }).length,
  };
}

module.exports = {
  index: async (req, res) => {
    const { Event } = req.models;

    const q = str(req.query.q);
    const status = str(req.query.status || "all");
    const type = str(req.query.type || "all");
    const audience = str(req.query.audience || "all");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { type: new RegExp(q, "i") },
        { audienceType: new RegExp(q, "i") },
        { audienceValue: new RegExp(q, "i") },
        { venue: new RegExp(q, "i") },
        { status: new RegExp(q, "i") },
      ];
    }

    if (status !== "all") query.status = status;
    if (type !== "all") query.type = type;
    if (audience !== "all") query.audienceType = audience;

    const events = await Event.find(query)
      .sort({ priority: -1, startAt: 1, createdAt: -1 })
      .lean();

    const data = events.map(serializeEvent);

    return res.render("tenant/admin/events/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      events: data,
      kpis: computeKpis(data),
      query: { q, status, type, audience },
    });
  },

  create: async (req, res) => {
    const { Event } = req.models;

    const title = str(req.body.title);
    const description = str(req.body.description);

    if (!title || !description) {
      req.flash?.("error", "Title and description are required.");
      return res.redirect("/admin/events");
    }

    const publishMode = str(req.body.publishMode || "Publish Now");
    let status = "Draft";
    let publishedAt = null;
    let scheduleAt = null;

    if (publishMode === "Publish Now") {
      status = "Published";
      publishedAt = new Date();
    } else if (publishMode === "Schedule") {
      status = "Scheduled";
      scheduleAt = asDate(req.body.scheduleAt);
    }

    await Event.create({
      title,
      description,
      type: str(req.body.type || "General"),
      priority: str(req.body.priority) === "Featured" ? "Featured" : "Normal",
      audienceType: str(req.body.audienceType || "Open Event"),
      audienceValue: str(req.body.audienceValue || "—"),
      venue: str(req.body.venue || ""),
      startAt: asDate(req.body.startAt),
      endAt: asDate(req.body.endAt),
      registrationDeadline: asDate(req.body.registrationDeadline),
      capacity: Number(req.body.capacity || 0),
      status,
      scheduleAt,
      publishedAt,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Event created successfully.");
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

    const title = str(req.body.title);
    const description = str(req.body.description);

    if (!title || !description) {
      req.flash?.("error", "Title and description are required.");
      return res.redirect("/admin/events");
    }

    const publishMode = str(req.body.publishMode || "Publish Now");
    let status = "Draft";
    let publishedAt = null;
    let scheduleAt = null;

    if (publishMode === "Publish Now") {
      status = "Published";
      publishedAt = item.publishedAt || new Date();
    } else if (publishMode === "Schedule") {
      status = "Scheduled";
      scheduleAt = asDate(req.body.scheduleAt);
    }

    item.title = title;
    item.description = description;
    item.type = str(req.body.type || "General");
    item.priority = str(req.body.priority) === "Featured" ? "Featured" : "Normal";
    item.audienceType = str(req.body.audienceType || "Open Event");
    item.audienceValue = str(req.body.audienceValue || "—");
    item.venue = str(req.body.venue || "");
    item.startAt = asDate(req.body.startAt);
    item.endAt = asDate(req.body.endAt);
    item.registrationDeadline = asDate(req.body.registrationDeadline);
    item.capacity = Number(req.body.capacity || 0);
    item.status = status;
    item.scheduleAt = scheduleAt;
    item.publishedAt = publishedAt;
    item.updatedBy = actorUserId(req);

    await item.save();

    req.flash?.("success", "Event updated successfully.");
    return res.redirect("/admin/events");
  },

  publish: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");

    await Event.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Published", scheduleAt: null, publishedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/events");
  },

  cancel: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");

    await Event.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Cancelled", updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/events");
  },

  delete: async (req, res) => {
    const { Event } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/events");

    await Event.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/events");
  },

  bulkAction: async (req, res) => {
    const { Event } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/events");

    const patch = { updatedBy: actorUserId(req) };

    if (action === "publish") {
      patch.status = "Published";
      patch.scheduleAt = null;
      patch.publishedAt = new Date();
    } else if (action === "cancel") {
      patch.status = "Cancelled";
    } else if (action === "feature") {
      patch.priority = "Featured";
    } else if (action === "unfeature") {
      patch.priority = "Normal";
    } else {
      return res.redirect("/admin/events");
    }

    await Event.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    return res.redirect("/admin/events");
  },
};