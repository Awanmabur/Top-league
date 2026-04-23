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

const asBool = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

function buildAnnouncementFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const category = str(query.category || "all");
  const audience = str(query.audience || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };

  if (q) {
    mongo.$or = [
      { title: new RegExp(q, "i") },
      { body: new RegExp(q, "i") },
      { category: new RegExp(q, "i") },
      { audienceType: new RegExp(q, "i") },
      { audienceValue: new RegExp(q, "i") },
      { status: new RegExp(q, "i") },
    ];
  }

  if (status && status !== "all") mongo.status = status;
  if (category && category !== "all") mongo.category = category;
  if (audience && audience !== "all") mongo.audienceType = audience;

  return {
    mongo,
    clean: { q, status, category, audience, view },
  };
}

function serializeAnnouncement(doc) {
  return {
    id: String(doc._id),
    title: doc.title || "",
    cat: doc.category || "General",
    audType: doc.audienceType || "All Students",
    audVal: doc.audienceValue || "—",
    ch: {
      portal: !!doc.channels?.portal,
      email: !!doc.channels?.email,
      sms: !!doc.channels?.sms,
      push: !!doc.channels?.push,
    },
    schedule: doc.scheduleAt ? new Date(doc.scheduleAt).toISOString().slice(0, 16).replace("T", " ") : "—",
    status: doc.status || "Draft",
    pinned: doc.priority === "Pinned",
    ack: !!doc.requiresAcknowledgement,
    created: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
    body: doc.body || "",
    expiryDate: doc.expiryDate ? new Date(doc.expiryDate).toISOString().slice(0, 10) : "",
    stats: {
      views: Number(doc.stats?.views || 0),
      opens: Number(doc.stats?.emailOpens || 0),
      sms: Number(doc.stats?.smsDelivered || 0),
      clicks: Number(doc.stats?.clicks || 0),
      ack: Number(doc.stats?.acknowledgements || 0),
    },
    attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
    receipts: Array.isArray(doc.receipts)
      ? doc.receipts.map((r) => ({
          id: String(r._id),
          user: r.name || "",
          email: r.email || "",
          role: r.role || "",
          status: r.status || "Unread",
          readAt: r.readAt ? new Date(r.readAt).toISOString().slice(0, 16).replace("T", " ") : "—",
          ackAt: r.ackAt ? new Date(r.ackAt).toISOString().slice(0, 16).replace("T", " ") : "—",
        }))
      : [],
  };
}

function computeKpis(list = []) {
  return {
    published: list.filter((x) => x.status === "Published").length,
    scheduled: list.filter((x) => x.status === "Scheduled").length,
    drafts: list.filter((x) => x.status === "Draft").length,
    ackRequired: list.filter((x) => !!x.ack).length,
  };
}

module.exports = {
  /**
   * GET /admin/announcements
   */
  index: async (req, res) => {
    const { Announcement } = req.models;

    const { mongo, clean } = buildAnnouncementFilters(req.query);

    const announcements = await Announcement.find(mongo)
      .sort({ priority: -1, publishedAt: -1, createdAt: -1 })
      .lean();

    const data = announcements.map(serializeAnnouncement);
    const kpis = computeKpis(data);

    return res.render("tenant/announcements/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      announcements: data,
      kpis,
      query: clean,
    });
  },

  /**
   * POST /admin/announcements
   */
  create: async (req, res) => {
    const { Announcement } = req.models;

    const title = str(req.body.title);
    const body = str(req.body.body);
    const category = str(req.body.category || "General");
    const priority = str(req.body.priority || "Normal");
    const audienceType = str(req.body.audienceType || "All Students");
    const audienceValue = str(req.body.audienceValue || "—");
    const requiresAcknowledgement = asBool(req.body.requiresAcknowledgement);

    const publishMode = str(req.body.publishMode || "Publish Now");
    const scheduleAt = asDate(req.body.scheduleAt);
    const expiryDate = asDate(req.body.expiryDate);

    if (!title || !body) {
      req.flash?.("error", "Title and message are required.");
      return res.redirect("/admin/announcements");
    }

    let status = "Draft";
    let publishedAt = null;

    if (publishMode === "Publish Now") {
      status = "Published";
      publishedAt = new Date();
    } else if (publishMode === "Schedule") {
      status = "Scheduled";
    } else {
      status = "Draft";
    }

    await Announcement.create({
      title,
      body,
      category,
      priority: priority === "Pinned" ? "Pinned" : "Normal",
      audienceType,
      audienceValue: audienceValue || "—",
      requiresAcknowledgement,
      channels: {
        portal: true,
        email: asBool(req.body.channelEmail),
        sms: asBool(req.body.channelSms),
        push: asBool(req.body.channelPush),
      },
      status,
      scheduleAt: status === "Scheduled" ? scheduleAt : null,
      publishedAt,
      expiryDate,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Announcement created successfully.");
    return res.redirect("/admin/announcements");
  },

  /**
   * POST /admin/announcements/:id/update
   */
  update: async (req, res) => {
    const { Announcement } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }

    const existing = await Announcement.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!existing) {
      req.flash?.("error", "Announcement not found.");
      return res.redirect("/admin/announcements");
    }

    const title = str(req.body.title);
    const body = str(req.body.body);
    const category = str(req.body.category || "General");
    const priority = str(req.body.priority || "Normal");
    const audienceType = str(req.body.audienceType || "All Students");
    const audienceValue = str(req.body.audienceValue || "—");
    const requiresAcknowledgement = asBool(req.body.requiresAcknowledgement);

    const publishMode = str(req.body.publishMode || "Publish Now");
    const scheduleAt = asDate(req.body.scheduleAt);
    const expiryDate = asDate(req.body.expiryDate);

    if (!title || !body) {
      req.flash?.("error", "Title and message are required.");
      return res.redirect("/admin/announcements");
    }

    let status = "Draft";
    let publishedAt = existing.publishedAt || null;

    if (publishMode === "Publish Now") {
      status = "Published";
      publishedAt = existing.publishedAt || new Date();
    } else if (publishMode === "Schedule") {
      status = "Scheduled";
      publishedAt = null;
    } else {
      status = "Draft";
      publishedAt = null;
    }

    existing.title = title;
    existing.body = body;
    existing.category = category;
    existing.priority = priority === "Pinned" ? "Pinned" : "Normal";
    existing.audienceType = audienceType;
    existing.audienceValue = audienceValue || "—";
    existing.requiresAcknowledgement = requiresAcknowledgement;

    existing.channels = {
      portal: true,
      email: asBool(req.body.channelEmail),
      sms: asBool(req.body.channelSms),
      push: asBool(req.body.channelPush),
    };

    existing.status = status;
    existing.scheduleAt = status === "Scheduled" ? scheduleAt : null;
    existing.publishedAt = publishedAt;
    existing.expiryDate = expiryDate;
    existing.updatedBy = actorUserId(req);

    await existing.save();

    req.flash?.("success", "Announcement updated successfully.");
    return res.redirect("/admin/announcements");
  },

  /**
   * POST /admin/announcements/:id/publish
   */
  publish: async (req, res) => {
    const { Announcement } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }

    await Announcement.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          status: "Published",
          scheduleAt: null,
          publishedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Announcement published.");
    return res.redirect("/admin/announcements");
  },

  /**
   * POST /admin/announcements/:id/unpublish
   */
  unpublish: async (req, res) => {
    const { Announcement } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }

    await Announcement.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          status: "Unpublished",
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Announcement unpublished.");
    return res.redirect("/admin/announcements");
  },

  /**
   * POST /admin/announcements/:id/delete
   */
  delete: async (req, res) => {
    const { Announcement } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }

    await Announcement.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    req.flash?.("success", "Announcement deleted.");
    return res.redirect("/admin/announcements");
  },

  /**
   * POST /admin/announcements/bulk
   */
  bulkAction: async (req, res) => {
    const { Announcement } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No announcements selected.");
      return res.redirect("/admin/announcements");
    }

    const action = str(req.body.action);

    const patch = { updatedBy: actorUserId(req) };

    if (action === "publish") {
      patch.status = "Published";
      patch.scheduleAt = null;
      patch.publishedAt = new Date();
    }

    if (action === "unpublish") {
      patch.status = "Unpublished";
    }

    if (action === "pin") {
      patch.priority = "Pinned";
    }

    if (action === "unpin") {
      patch.priority = "Normal";
    }

    if (action === "draft") {
      patch.status = "Draft";
      patch.publishedAt = null;
      patch.scheduleAt = null;
    }

    await Announcement.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/announcements");
  },
};