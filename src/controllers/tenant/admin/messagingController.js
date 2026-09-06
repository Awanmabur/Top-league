const mongoose = require("mongoose");
const {
  escapeRegex,
  normalizeAudienceType,
  dispatchMessage,
  processDueMessages,
  getMessageRecipients,
  resendOrRemind,
} = require("../../../services/tenant/messageService");

const MESSAGE_TYPES = ["General", "Notice", "Reminder", "Alert", "Invitation"];
const AUDIENCE_TYPES = [
  "All Students",
  "All Staff",
  "Specific Department",
  "Specific Program",
  "Specific Subject",
  "Year/Cohort",
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

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function normalizeChannels(req) {
  const requestedPortal = asBool(req.body.channelPortal);
  const requestedEmail = asBool(req.body.channelEmail);
  const requestedSms = asBool(req.body.channelSms);
  const requestedPush = asBool(req.body.channelPush);
  const warnings = [];
  const smtpReady = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

  if (requestedEmail && !smtpReady) warnings.push("Email was not enabled because SMTP is not configured.");
  if (requestedSms) warnings.push("SMS was not enabled because no SMS delivery provider is configured in this build.");
  if (requestedPush) warnings.push("Push was not enabled because no push delivery provider is configured in this build.");

  const channels = {
    portal: requestedPortal,
    email: requestedEmail && smtpReady,
    sms: false,
    push: false,
  };
  if (!channels.portal && !channels.email) {
    channels.portal = true;
    warnings.push("Portal delivery was enabled because no other configured delivery channel remained available.");
  }
  return { channels, warnings };
}

function validatePayload(req, existing = null) {
  const subject = str(req.body.subject);
  const body = str(req.body.body);
  const type = MESSAGE_TYPES.includes(str(req.body.type)) ? str(req.body.type) : "General";
  const priority = str(req.body.priority) === "Important" ? "Important" : "Normal";
  const audienceType = normalizeAudienceType(req.body.audienceType);
  const audienceValue = str(req.body.audienceValue || "—") || "—";
  const senderName = str(req.body.senderName);
  const replyTo = str(req.body.replyTo);
  const sendMode = str(req.body.sendMode || "Send Now");
  const scheduleAt = asDate(req.body.scheduleAt);
  const { channels, warnings } = normalizeChannels(req);
  const errors = [];

  if (!subject) errors.push("Subject is required.");
  if (!body) errors.push("Message is required.");
  if (subject.length > 220) errors.push("Subject must be 220 characters or fewer.");
  if (body.length > 5000) errors.push("Message must be 5000 characters or fewer.");
  if (!AUDIENCE_TYPES.includes(audienceType)) errors.push("Choose a valid audience type.");
  if (!["All Students", "All Staff"].includes(audienceType) && (!audienceValue || audienceValue === "—")) {
    errors.push("Audience Value is required for the selected targeted audience.");
  }
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) errors.push("Reply-To must be a valid email address.");

  const now = new Date();
  let status = existing?.status || "Draft";
  if (sendMode === "Schedule") {
    status = "Scheduled";
    if (!scheduleAt) errors.push("A valid schedule date/time is required.");
    else if (scheduleAt <= now) errors.push("Scheduled delivery must be in the future.");
  } else if (sendMode === "Save as Draft") {
    status = "Draft";
  } else {
    status = "Sent";
  }

  return {
    errors,
    warnings,
    value: {
      subject,
      body,
      type,
      priority,
      audienceType,
      audienceValue,
      senderName,
      replyTo,
      sendMode,
      scheduleAt,
      channels,
      status,
    },
  };
}

function flashWarnings(req, warnings = []) {
  for (const warning of warnings) req.flash?.("warning", warning);
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const type = str(query.type || "all");
  const audienceRaw = str(query.audience || "all");
  const audience = audienceRaw === "all" ? "all" : normalizeAudienceType(audienceRaw);
  const view = str(query.view || "list") || "list";
  const mongo = { isDeleted: { $ne: true } };

  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    mongo.$or = [
      { subject: re },
      { body: re },
      { type: re },
      { audienceType: re },
      { audienceValue: re },
      { status: re },
    ];
  }
  if (status !== "all") mongo.status = status;
  if (type !== "all") mongo.type = type;
  if (audience !== "all") mongo.audienceType = audience;
  return { mongo, clean: { q, status, type, audience, view } };
}

function serializeRecipient(r) {
  return {
    id: String(r._id || ""),
    user: r.name || "",
    email: r.email || "",
    role: r.role || "",
    status: r.status || "Pending",
    deliveredAt: formatDateTime(r.deliveredAt),
    openedAt: formatDateTime(r.openedAt),
  };
}

function serializeMessage(doc, recipients = []) {
  return {
    id: String(doc._id),
    subject: doc.subject || "",
    type: doc.type || "General",
    audType: normalizeAudienceType(doc.audienceType || "All Students"),
    audVal: doc.audienceValue || "—",
    senderName: doc.senderName || "",
    replyTo: doc.replyTo || "",
    ch: {
      portal: !!doc.channels?.portal,
      email: !!doc.channels?.email,
      sms: !!doc.channels?.sms,
      push: !!doc.channels?.push,
    },
    schedule: formatDateTime(doc.scheduleAt),
    scheduleAtRaw: doc.scheduleAt ? new Date(doc.scheduleAt).toISOString().slice(0, 16) : "",
    status: doc.status || "Draft",
    important: doc.priority === "Important",
    body: doc.body || "",
    stats: {
      recipients: Number(doc.stats?.recipients || 0),
      delivered: Number(doc.stats?.delivered || 0),
      opened: Number(doc.stats?.opened || 0),
      failed: Number(doc.stats?.failed || 0),
    },
    recipients: recipients.map(serializeRecipient),
  };
}

function serializeTemplate(doc) {
  return {
    id: String(doc._id),
    name: doc.name || "Template",
    subject: doc.subject || "",
    body: doc.body || "",
    type: doc.type || "General",
    important: doc.priority === "Important",
    audType: normalizeAudienceType(doc.audienceType || "All Students"),
    audVal: doc.audienceValue || "—",
    senderName: doc.senderName || "",
    replyTo: doc.replyTo || "",
    ch: {
      portal: !!doc.channels?.portal,
      email: !!doc.channels?.email,
      sms: false,
      push: false,
    },
  };
}

function computeKpis(list = []) {
  return {
    sent: list.filter((x) => x.status === "Sent").length,
    scheduled: list.filter((x) => x.status === "Scheduled").length,
    drafts: list.filter((x) => x.status === "Draft").length,
    failed: list.filter((x) => x.status === "Failed").length,
  };
}

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function saveValidatedMessage(req, item, checked) {
  const v = checked.value;
  item.subject = v.subject;
  item.body = v.body;
  item.type = v.type;
  item.priority = v.priority;
  item.audienceType = v.audienceType;
  item.audienceValue = v.audienceValue;
  item.senderName = v.senderName;
  item.replyTo = v.replyTo;
  item.channels = v.channels;
  item.updatedBy = actorUserId(req);

  if (v.status === "Scheduled") {
    item.status = "Scheduled";
    item.scheduleAt = v.scheduleAt;
    item.scheduleClaimedAt = null;
    item.sentAt = null;
    await item.save();
    return { dispatched: false };
  }
  if (v.status === "Draft") {
    item.status = "Draft";
    item.scheduleAt = null;
    item.scheduleClaimedAt = null;
    item.sentAt = null;
    await item.save();
    return { dispatched: false };
  }

  item.status = "Draft";
  item.scheduleAt = null;
  item.scheduleClaimedAt = null;
  await item.save();
  const result = await dispatchMessage(req, item, new Date(), { updatedBy: actorUserId(req) });
  return { dispatched: true, result };
}

module.exports = {
  index: async (req, res) => {
    const { Message, MessageTemplate } = req.models;
    await processDueMessages(req).catch((err) => console.error("MESSAGE SCHEDULER ERROR:", err));
    const { mongo, clean } = buildFilters(req.query);
    const pageSize = 100;
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const [messages, total, kpiRows, templates] = await Promise.all([
      Message.find(mongo).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Message.countDocuments(mongo),
      Message.aggregate([
        { $match: mongo },
        { $group: {
          _id: null,
          sent: { $sum: { $cond: [{ $eq: ["$status", "Sent"] }, 1, 0] } },
          scheduled: { $sum: { $cond: [{ $eq: ["$status", "Scheduled"] }, 1, 0] } },
          drafts: { $sum: { $cond: [{ $eq: ["$status", "Draft"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
        } },
      ]).catch(() => []),
      MessageTemplate
        ? MessageTemplate.find({ isDeleted: { $ne: true }, isActive: true }).sort({ name: 1 }).limit(200).lean().catch(() => [])
        : Promise.resolve([]),
    ]);
    const recipientsByMessage = await getMessageRecipients(req, messages.map((x) => x._id));
    const data = messages.map((doc) => serializeMessage(doc, recipientsByMessage.get(String(doc._id)) || []));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const makePageUrl = (target) => { const qs = new URLSearchParams(req.query || {}); qs.set("page", String(target)); return `/admin/messaging?${qs.toString()}`; };

    return res.render("tenant/messaging/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      messages: data,
      templates: templates.map(serializeTemplate),
      kpis: kpiRows[0] || { sent: 0, scheduled: 0, drafts: 0, failed: 0 },
      query: clean,
      pagination: { page, pageSize, total, pageCount, prevUrl: page > 1 ? makePageUrl(page - 1) : "", nextUrl: page < pageCount ? makePageUrl(page + 1) : "" },
    });
  },

  create: async (req, res) => {
    const { Message } = req.models;
    const checked = validatePayload(req);
    if (checked.errors.length) {
      req.flash?.("error", checked.errors.join(" "));
      flashWarnings(req, checked.warnings);
      return res.redirect("/admin/messaging");
    }

    const item = new Message({ createdBy: actorUserId(req), updatedBy: actorUserId(req) });
    const result = await saveValidatedMessage(req, item, checked);
    flashWarnings(req, checked.warnings);
    if (result.dispatched && !result.result?.ok) {
      req.flash?.("error", "Message could not be delivered because the selected audience has no eligible recipients.");
    } else {
      req.flash?.("success", result.dispatched ? "Message sent successfully." : "Message saved successfully.");
    }
    return res.redirect("/admin/messaging");
  },

  update: async (req, res) => {
    const { Message } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid message ID.");
      return res.redirect("/admin/messaging");
    }
    const item = await Message.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) {
      req.flash?.("error", "Message not found.");
      return res.redirect("/admin/messaging");
    }
    const checked = validatePayload(req, item);
    if (checked.errors.length) {
      req.flash?.("error", checked.errors.join(" "));
      flashWarnings(req, checked.warnings);
      return res.redirect("/admin/messaging");
    }
    const result = await saveValidatedMessage(req, item, checked);
    flashWarnings(req, checked.warnings);
    if (result.dispatched && !result.result?.ok) {
      req.flash?.("error", "Message could not be delivered because the selected audience has no eligible recipients.");
    } else {
      req.flash?.("success", result.dispatched ? "Message updated and delivered." : "Message updated successfully.");
    }
    return res.redirect("/admin/messaging");
  },

  send: async (req, res) => {
    const { Message } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid message ID.");
      return res.redirect("/admin/messaging");
    }
    const item = await Message.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) {
      req.flash?.("error", "Message not found.");
      return res.redirect("/admin/messaging");
    }
    const result = await dispatchMessage(req, item, new Date(), { updatedBy: actorUserId(req) });
    req.flash?.(result.ok ? "success" : "error", result.ok ? "Message delivered and recipients synchronized." : "The selected audience has no eligible recipients.");
    return res.redirect("/admin/messaging");
  },

  archive: async (req, res) => {
    const { Message } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/messaging");
    const result = await Message.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Archived", scheduleAt: null, scheduleClaimedAt: null, updatedBy: actorUserId(req) } }
    );
    req.flash?.(result.matchedCount ? "success" : "error", result.matchedCount ? "Message archived." : "Message not found.");
    return res.redirect("/admin/messaging");
  },

  delete: async (req, res) => {
    const { Message, MessageRecipient, Notification } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/messaging");
    const result = await Message.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), scheduleClaimedAt: null, updatedBy: actorUserId(req) } }
    );
    if (result.matchedCount) {
      await MessageRecipient?.deleteMany({ messageId: req.params.id }).catch(() => {});
      await Notification?.updateMany(
        { entityType: "Message", entityId: req.params.id, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date() } }
      ).catch(() => {});
    }
    req.flash?.(result.matchedCount ? "success" : "error", result.matchedCount ? "Message deleted." : "Message not found.");
    return res.redirect("/admin/messaging");
  },

  bulkAction: async (req, res) => {
    const { Message } = req.models;
    const ids = str(req.body.ids).split(",").map((x) => x.trim()).filter(isValidId);
    const action = str(req.body.action);
    if (!ids.length) {
      req.flash?.("error", "No messages selected.");
      return res.redirect("/admin/messaging");
    }
    if (!["send", "archive", "draft"].includes(action)) {
      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/messaging");
    }

    if (action === "send") {
      const docs = await Message.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
      let delivered = 0;
      let empty = 0;
      for (const doc of docs) {
        const result = await dispatchMessage(req, doc, new Date(), { updatedBy: actorUserId(req) });
        if (result.ok) delivered += 1; else empty += 1;
      }
      req.flash?.("success", `${delivered} message(s) delivered.`);
      if (empty) req.flash?.("warning", `${empty} message(s) had no eligible recipients.`);
    } else {
      const patch = { updatedBy: actorUserId(req), scheduleAt: null, scheduleClaimedAt: null };
      if (action === "archive") patch.status = "Archived";
      if (action === "draft") Object.assign(patch, { status: "Draft", sentAt: null });
      await Message.updateMany({ _id: { $in: ids }, isDeleted: { $ne: true } }, { $set: patch });
      req.flash?.("success", "Bulk action applied.");
    }
    return res.redirect("/admin/messaging");
  },

  remind: async (req, res) => {
    const { Message } = req.models;
    await processDueMessages(req).catch(() => {});
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid message ID.");
      return res.redirect("/admin/messaging?view=recipients");
    }
    const item = await Message.findOne({ _id: req.params.id, isDeleted: { $ne: true }, status: "Sent" });
    if (!item) {
      req.flash?.("error", "Only sent messages can send reminders.");
      return res.redirect("/admin/messaging?view=recipients");
    }
    const result = await resendOrRemind(req, item);
    req.flash?.("success", `Reminder sent to ${result.reminded} unopened recipient(s).`);
    if (result.failedEmails) req.flash?.("warning", `${result.failedEmails} reminder email(s) could not be delivered.`);
    return res.redirect(`/admin/messaging?view=recipients&message=${item._id}`);
  },

  exportCsv: async (req, res) => {
    const { Message } = req.models;
    await processDueMessages(req).catch(() => {});
    const { mongo } = buildFilters(req.query);
    const rows = await Message.find(mongo).sort({ createdAt: -1 }).lean();
    const headers = ["Subject", "Type", "Audience Type", "Audience Value", "Priority", "Status", "Scheduled At", "Sent At", "Recipients", "Delivered", "Opened", "Failed"];
    const lines = [headers.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push([
        row.subject,
        row.type,
        normalizeAudienceType(row.audienceType),
        row.audienceValue,
        row.priority,
        row.status,
        row.scheduleAt ? new Date(row.scheduleAt).toISOString() : "",
        row.sentAt ? new Date(row.sentAt).toISOString() : "",
        Number(row.stats?.recipients || 0),
        Number(row.stats?.delivered || 0),
        Number(row.stats?.opened || 0),
        Number(row.stats?.failed || 0),
      ].map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="messages-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },

  createTemplate: async (req, res) => {
    const { MessageTemplate } = req.models;
    if (!MessageTemplate) {
      req.flash?.("error", "Message templates are unavailable for this tenant.");
      return res.redirect("/admin/messaging");
    }
    const name = str(req.body.name);
    const subject = str(req.body.subject);
    const body = str(req.body.body);
    if (!name || !subject || !body) {
      req.flash?.("error", "Template name, subject and message are required.");
      return res.redirect("/admin/messaging");
    }
    const audienceType = normalizeAudienceType(req.body.audienceType);
    if (!AUDIENCE_TYPES.includes(audienceType)) {
      req.flash?.("error", "Choose a valid audience type.");
      return res.redirect("/admin/messaging");
    }
    await MessageTemplate.create({
      name: name.slice(0, 120),
      subject: subject.slice(0, 220),
      body: body.slice(0, 5000),
      type: MESSAGE_TYPES.includes(str(req.body.type)) ? str(req.body.type) : "General",
      priority: str(req.body.priority) === "Important" ? "Important" : "Normal",
      audienceType,
      audienceValue: str(req.body.audienceValue || "—") || "—",
      senderName: str(req.body.senderName),
      replyTo: str(req.body.replyTo),
      channels: { portal: true, email: false, sms: false, push: false },
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });
    req.flash?.("success", "Message template created.");
    return res.redirect("/admin/messaging");
  },

  deleteTemplate: async (req, res) => {
    const { MessageTemplate } = req.models;
    if (!MessageTemplate || !isValidId(req.params.id)) {
      req.flash?.("error", "Invalid message template.");
      return res.redirect("/admin/messaging");
    }
    await MessageTemplate.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, isActive: false, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );
    req.flash?.("success", "Message template deleted.");
    return res.redirect("/admin/messaging");
  },
};
