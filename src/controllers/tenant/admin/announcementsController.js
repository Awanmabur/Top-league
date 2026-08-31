const mongoose = require("mongoose");
const {
  escapeRegex,
  normalizeAudienceType,
  activateAnnouncement,
  publishDueAnnouncements,
  getReceipts,
  remindUnreadRecipients,
} = require("../../../services/tenant/announcementService");

const CATEGORIES = ["Academic", "Finance", "Hostel", "Library", "Exams", "General", "Emergency"];
const AUDIENCE_TYPES = [
  "All Students",
  "All Staff",
  "All Parents",
  "Specific Department",
  "Specific Program",
  "Specific Subject",
  "Year/Cohort",
  "Hostel Residents",
];

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const str = (v) => String(v ?? "").trim();
const asBool = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function normalizeChannels(req) {
  const requestedEmail = asBool(req.body.channelEmail);
  const requestedSms = asBool(req.body.channelSms);
  const requestedPush = asBool(req.body.channelPush);
  const warnings = [];

  const smtpReady = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (requestedEmail && !smtpReady) warnings.push("Email was not enabled because SMTP is not configured.");
  if (requestedSms) warnings.push("SMS was not enabled because no SMS delivery provider is configured in this build.");
  if (requestedPush) warnings.push("Push was not enabled because no push delivery provider is configured in this build.");

  return {
    channels: {
      portal: true,
      email: requestedEmail && smtpReady,
      sms: false,
      push: false,
    },
    warnings,
  };
}

function validatePayload(req, existing = null) {
  const title = str(req.body.title);
  const body = str(req.body.body);
  const category = CATEGORIES.includes(str(req.body.category)) ? str(req.body.category) : "General";
  const priority = str(req.body.priority) === "Pinned" ? "Pinned" : "Normal";
  const audienceType = normalizeAudienceType(req.body.audienceType);
  const audienceValue = str(req.body.audienceValue || "—") || "—";
  const requiresAcknowledgement = asBool(req.body.requiresAcknowledgement);
  const publishMode = str(req.body.publishMode || "Publish Now");
  const scheduleAt = asDate(req.body.scheduleAt);
  const expiryDate = asDate(req.body.expiryDate);
  const { channels, warnings } = normalizeChannels(req);

  const errors = [];
  if (!title) errors.push("Title is required.");
  if (!body) errors.push("Message is required.");
  if (title.length > 220) errors.push("Title must be 220 characters or fewer.");
  if (body.length > 5000) errors.push("Message must be 5000 characters or fewer.");
  if (!AUDIENCE_TYPES.includes(audienceType)) errors.push("Choose a valid audience type.");

  if (!["All Students", "All Staff", "All Parents"].includes(audienceType) && (!audienceValue || audienceValue === "—")) {
    errors.push("Audience Value is required for the selected targeted audience.");
  }

  const now = new Date();
  if (publishMode === "Schedule") {
    if (!scheduleAt) errors.push("A valid schedule date/time is required.");
    else if (scheduleAt <= now) errors.push("Scheduled publishing must be in the future.");
  }
  if (expiryDate) {
    const startsAt = publishMode === "Schedule" ? scheduleAt : now;
    if (startsAt && expiryDate <= startsAt) errors.push("Expiry must be after the publish/schedule time.");
  }

  let status = existing?.status || "Draft";
  if (publishMode === "Schedule") status = "Scheduled";
  else if (publishMode === "Save as Draft") status = "Draft";
  else status = "Published";

  return {
    errors,
    warnings,
    value: {
      title,
      body,
      category,
      priority,
      audienceType,
      audienceValue,
      requiresAcknowledgement,
      publishMode,
      scheduleAt,
      expiryDate,
      channels,
      status,
    },
  };
}

function buildAnnouncementFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const category = str(query.category || "all");
  const audience = normalizeAudienceType(query.audience || "all");
  const view = str(query.view || "list") || "list";

  const mongo = { isDeleted: { $ne: true } };
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { title: re },
      { body: re },
      { category: re },
      { audienceType: re },
      { audienceValue: re },
      { status: re },
    ];
  }
  if (status && status !== "all") mongo.status = status;
  if (category && category !== "all") mongo.category = category;
  if (audience && audience !== "all") mongo.audienceType = audience;

  return { mongo, clean: { q, status, category, audience, view } };
}

function serializeReceipt(r) {
  return {
    id: String(r._id || ""),
    user: r.name || "",
    email: r.email || "",
    role: r.role || "",
    status: r.status || "Unread",
    readAt: r.readAt ? new Date(r.readAt).toISOString().slice(0, 16).replace("T", " ") : "—",
    ackAt: r.ackAt ? new Date(r.ackAt).toISOString().slice(0, 16).replace("T", " ") : "—",
  };
}

function serializeAnnouncement(doc, receipts = []) {
  const receiptRows = receipts.length ? receipts : (Array.isArray(doc.receipts) ? doc.receipts : []);
  return {
    id: String(doc._id),
    title: doc.title || "",
    cat: doc.category || "General",
    audType: normalizeAudienceType(doc.audienceType || "All Students"),
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
    receipts: receiptRows.map(serializeReceipt),
  };
}

function serializeTemplate(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "Template",
    title: doc.title || "",
    body: doc.body || "",
    cat: doc.category || "General",
    pinned: doc.priority === "Pinned",
    audType: normalizeAudienceType(doc.audienceType || "All Students"),
    audVal: doc.audienceValue || "—",
    ack: !!doc.requiresAcknowledgement,
    ch: {
      portal: true,
      email: !!doc.channels?.email,
      sms: false,
      push: false,
    },
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

function flashWarnings(req, warnings = []) {
  for (const warning of warnings) req.flash?.("warning", warning);
}

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  index: async (req, res) => {
    const { Announcement, AnnouncementTemplate } = req.models;
    await publishDueAnnouncements(req).catch((err) => console.error("ANNOUNCEMENT SCHEDULER ERROR:", err));

    const { mongo, clean } = buildAnnouncementFilters(req.query);
    const announcements = await Announcement.find(mongo)
      .sort({ priority: -1, publishedAt: -1, createdAt: -1 })
      .lean();
    const receiptsByAnnouncement = await getReceipts(req, announcements.map((x) => x._id));
    const data = announcements.map((doc) => serializeAnnouncement(doc, receiptsByAnnouncement.get(String(doc._id)) || []));
    const templates = AnnouncementTemplate
      ? await AnnouncementTemplate.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).lean().catch(() => [])
      : [];

    return res.render("tenant/announcements/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      announcements: data,
      templates: templates.map(serializeTemplate),
      kpis: computeKpis(data),
      query: clean,
    });
  },

  create: async (req, res) => {
    const { Announcement } = req.models;
    const checked = validatePayload(req);
    if (checked.errors.length) {
      req.flash?.("error", checked.errors.join(" "));
      flashWarnings(req, checked.warnings);
      return res.redirect("/admin/announcements");
    }
    const v = checked.value;
    const doc = await Announcement.create({
      title: v.title,
      body: v.body,
      category: v.category,
      priority: v.priority,
      audienceType: v.audienceType,
      audienceValue: v.audienceValue,
      requiresAcknowledgement: v.requiresAcknowledgement,
      channels: v.channels,
      status: v.status === "Published" ? "Draft" : v.status,
      scheduleAt: v.status === "Scheduled" ? v.scheduleAt : null,
      publishedAt: null,
      expiryDate: v.expiryDate,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    if (v.status === "Published") await activateAnnouncement(req, doc, new Date(), { updatedBy: actorUserId(req) });
    flashWarnings(req, checked.warnings);
    req.flash?.("success", v.status === "Published" ? "Announcement published successfully." : "Announcement saved successfully.");
    return res.redirect("/admin/announcements");
  },

  update: async (req, res) => {
    const { Announcement } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }
    const existing = await Announcement.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!existing) {
      req.flash?.("error", "Announcement not found.");
      return res.redirect("/admin/announcements");
    }

    const checked = validatePayload(req, existing);
    if (checked.errors.length) {
      req.flash?.("error", checked.errors.join(" "));
      flashWarnings(req, checked.warnings);
      return res.redirect("/admin/announcements");
    }
    const v = checked.value;
    existing.title = v.title;
    existing.body = v.body;
    existing.category = v.category;
    existing.priority = v.priority;
    existing.audienceType = v.audienceType;
    existing.audienceValue = v.audienceValue;
    existing.requiresAcknowledgement = v.requiresAcknowledgement;
    existing.channels = v.channels;
    existing.expiryDate = v.expiryDate;
    existing.updatedBy = actorUserId(req);

    if (v.status === "Published") {
      existing.status = "Published";
      existing.scheduleAt = null;
      existing.publishedAt = existing.publishedAt || new Date();
      await existing.save();
      await activateAnnouncement(req, existing, new Date(), { updatedBy: actorUserId(req) });
    } else {
      existing.status = v.status;
      existing.scheduleAt = v.status === "Scheduled" ? v.scheduleAt : null;
      existing.publishedAt = null;
      await existing.save();
    }

    flashWarnings(req, checked.warnings);
    req.flash?.("success", "Announcement updated successfully.");
    return res.redirect("/admin/announcements");
  },

  publish: async (req, res) => {
    const { Announcement } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }
    const doc = await Announcement.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!doc) {
      req.flash?.("error", "Announcement not found.");
      return res.redirect("/admin/announcements");
    }
    const alreadyPublished = doc.status === "Published";
    const activated = await activateAnnouncement(req, doc, new Date(), { updatedBy: actorUserId(req) });
    if (!activated) {
      req.flash?.("error", "Expired announcements cannot be published. Update the expiry date first.");
      return res.redirect("/admin/announcements");
    }
    req.flash?.("success", alreadyPublished ? "Announcement recipients synchronized." : "Announcement published.");
    return res.redirect("/admin/announcements");
  },

  unpublish: async (req, res) => {
    const { Announcement } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }
    const result = await Announcement.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Unpublished", scheduleAt: null, updatedBy: actorUserId(req) } }
    );
    req.flash?.(result.matchedCount ? "success" : "error", result.matchedCount ? "Announcement unpublished." : "Announcement not found.");
    return res.redirect("/admin/announcements");
  },

  delete: async (req, res) => {
    const { Announcement } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements");
    }
    const result = await Announcement.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );
    req.flash?.(result.matchedCount ? "success" : "error", result.matchedCount ? "Announcement deleted." : "Announcement not found.");
    return res.redirect("/admin/announcements");
  },

  bulkAction: async (req, res) => {
    const { Announcement } = req.models;
    const ids = str(req.body.ids).split(",").map((x) => x.trim()).filter(isValidId);
    if (!ids.length) {
      req.flash?.("error", "No announcements selected.");
      return res.redirect("/admin/announcements");
    }
    const action = str(req.body.action);
    const allowed = ["publish", "unpublish", "pin", "unpin", "draft"];
    if (!allowed.includes(action)) {
      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/announcements");
    }

    if (action === "publish") {
      const docs = await Announcement.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
      let expiredSkipped = 0;
      for (const doc of docs) {
        const activated = await activateAnnouncement(req, doc, new Date(), { updatedBy: actorUserId(req) });
        if (!activated) expiredSkipped += 1;
      }
      if (expiredSkipped) req.flash?.("warning", `${expiredSkipped} expired announcement(s) were not published.`);
    } else {
      const patch = { updatedBy: actorUserId(req) };
      if (action === "unpublish") Object.assign(patch, { status: "Unpublished", scheduleAt: null });
      if (action === "pin") patch.priority = "Pinned";
      if (action === "unpin") patch.priority = "Normal";
      if (action === "draft") Object.assign(patch, { status: "Draft", publishedAt: null, scheduleAt: null });
      await Announcement.updateMany({ _id: { $in: ids }, isDeleted: { $ne: true } }, { $set: patch });
    }

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/announcements");
  },

  remind: async (req, res) => {
    const { Announcement } = req.models;
    await publishDueAnnouncements(req).catch(() => {});
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement ID.");
      return res.redirect("/admin/announcements?view=receipts");
    }
    const doc = await Announcement.findOne({ _id: req.params.id, isDeleted: { $ne: true }, status: "Published" });
    if (!doc) {
      req.flash?.("error", "Only published announcements can send reminders.");
      return res.redirect("/admin/announcements?view=receipts");
    }
    const result = await remindUnreadRecipients(req, doc);
    req.flash?.("success", `Reminder queued for ${result.reminded} recipient(s).`);
    if (result.failedEmails) req.flash?.("warning", `${result.failedEmails} reminder email(s) could not be delivered.`);
    return res.redirect("/admin/announcements?view=receipts");
  },

  exportCsv: async (req, res) => {
    const { Announcement } = req.models;
    await publishDueAnnouncements(req).catch(() => {});
    const { mongo } = buildAnnouncementFilters(req.query);
    const rows = await Announcement.find(mongo).sort({ createdAt: -1 }).lean();
    const headers = ["Title", "Category", "Audience Type", "Audience Value", "Priority", "Status", "Published At", "Scheduled At", "Expires", "Requires Acknowledgement", "Views", "Acknowledgements"];
    const lines = [headers.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push([
        row.title,
        row.category,
        normalizeAudienceType(row.audienceType),
        row.audienceValue,
        row.priority,
        row.status,
        row.publishedAt ? new Date(row.publishedAt).toISOString() : "",
        row.scheduleAt ? new Date(row.scheduleAt).toISOString() : "",
        row.expiryDate ? new Date(row.expiryDate).toISOString() : "",
        row.requiresAcknowledgement ? "Yes" : "No",
        Number(row.stats?.views || 0),
        Number(row.stats?.acknowledgements || 0),
      ].map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="announcements-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },

  createTemplate: async (req, res) => {
    const { AnnouncementTemplate } = req.models;
    if (!AnnouncementTemplate) {
      req.flash?.("error", "Announcement templates are unavailable for this tenant.");
      return res.redirect("/admin/announcements");
    }
    const name = str(req.body.name);
    const title = str(req.body.title);
    const body = str(req.body.body);
    if (!name || !title || !body) {
      req.flash?.("error", "Template name, title and message are required.");
      return res.redirect("/admin/announcements");
    }
    const category = CATEGORIES.includes(str(req.body.category)) ? str(req.body.category) : "General";
    const audienceType = AUDIENCE_TYPES.includes(normalizeAudienceType(req.body.audienceType))
      ? normalizeAudienceType(req.body.audienceType)
      : "All Students";
    await AnnouncementTemplate.create({
      name,
      title,
      body,
      category,
      priority: str(req.body.priority) === "Pinned" ? "Pinned" : "Normal",
      audienceType,
      audienceValue: str(req.body.audienceValue || "—") || "—",
      requiresAcknowledgement: asBool(req.body.requiresAcknowledgement),
      channels: { portal: true, email: false, sms: false, push: false },
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });
    req.flash?.("success", "Announcement template created.");
    return res.redirect("/admin/announcements");
  },

  deleteTemplate: async (req, res) => {
    const { AnnouncementTemplate } = req.models;
    if (!AnnouncementTemplate || !isValidId(req.params.id)) {
      req.flash?.("error", "Invalid announcement template.");
      return res.redirect("/admin/announcements");
    }
    await AnnouncementTemplate.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, isActive: false, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );
    req.flash?.("success", "Announcement template deleted.");
    return res.redirect("/admin/announcements");
  },
};
