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

const asBool = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

function serializeMessage(doc) {
  return {
    id: String(doc._id),
    subject: doc.subject || "",
    type: doc.type || "General",
    audType: doc.audienceType || "All Students",
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
    recipients: Array.isArray(doc.recipients)
      ? doc.recipients.map((r) => ({
          id: String(r._id),
          user: r.name || "",
          email: r.email || "",
          role: r.role || "",
          status: r.status || "Pending",
          deliveredAt: formatDateTime(r.deliveredAt),
          openedAt: formatDateTime(r.openedAt),
        }))
      : [],
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

module.exports = {
  index: async (req, res) => {
    const { Message } = req.models;

    const q = str(req.query.q);
    const status = str(req.query.status || "all");
    const type = str(req.query.type || "all");
    const audience = str(req.query.audience || "all");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { subject: new RegExp(q, "i") },
        { body: new RegExp(q, "i") },
        { type: new RegExp(q, "i") },
        { audienceType: new RegExp(q, "i") },
        { audienceValue: new RegExp(q, "i") },
        { status: new RegExp(q, "i") },
      ];
    }

    if (status !== "all") query.status = status;
    if (type !== "all") query.type = type;
    if (audience !== "all") query.audienceType = audience;

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const data = messages.map(serializeMessage);

    return res.render("tenant/admin/messaging/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      messages: data,
      kpis: computeKpis(data),
      query: { q, status, type, audience },
    });
  },

  create: async (req, res) => {
    const { Message } = req.models;

    const subject = str(req.body.subject);
    const body = str(req.body.body);

    if (!subject || !body) {
      req.flash?.("error", "Subject and message are required.");
      return res.redirect("/admin/messaging");
    }

    const sendMode = str(req.body.sendMode || "Send Now");
    let status = "Draft";
    let sentAt = null;
    let scheduleAt = null;

    if (sendMode === "Send Now") {
      status = "Sent";
      sentAt = new Date();
    } else if (sendMode === "Schedule") {
      status = "Scheduled";
      scheduleAt = asDate(req.body.scheduleAt);
    }

    await Message.create({
      subject,
      body,
      type: str(req.body.type || "General"),
      priority: str(req.body.priority) === "Important" ? "Important" : "Normal",
      audienceType: str(req.body.audienceType || "All Students"),
      audienceValue: str(req.body.audienceValue || "—"),
      senderName: str(req.body.senderName || ""),
      replyTo: str(req.body.replyTo || ""),
      channels: {
        portal: asBool(req.body.channelPortal),
        email: asBool(req.body.channelEmail),
        sms: asBool(req.body.channelSms),
        push: asBool(req.body.channelPush),
      },
      status,
      scheduleAt,
      sentAt,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Message saved successfully.");
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

    const subject = str(req.body.subject);
    const body = str(req.body.body);

    if (!subject || !body) {
      req.flash?.("error", "Subject and message are required.");
      return res.redirect("/admin/messaging");
    }

    const sendMode = str(req.body.sendMode || "Send Now");
    let status = "Draft";
    let sentAt = null;
    let scheduleAt = null;

    if (sendMode === "Send Now") {
      status = "Sent";
      sentAt = item.sentAt || new Date();
    } else if (sendMode === "Schedule") {
      status = "Scheduled";
      scheduleAt = asDate(req.body.scheduleAt);
    }

    item.subject = subject;
    item.body = body;
    item.type = str(req.body.type || "General");
    item.priority = str(req.body.priority) === "Important" ? "Important" : "Normal";
    item.audienceType = str(req.body.audienceType || "All Students");
    item.audienceValue = str(req.body.audienceValue || "—");
    item.senderName = str(req.body.senderName || "");
    item.replyTo = str(req.body.replyTo || "");
    item.channels = {
      portal: asBool(req.body.channelPortal),
      email: asBool(req.body.channelEmail),
      sms: asBool(req.body.channelSms),
      push: asBool(req.body.channelPush),
    };
    item.status = status;
    item.scheduleAt = scheduleAt;
    item.sentAt = sentAt;
    item.updatedBy = actorUserId(req);

    await item.save();

    req.flash?.("success", "Message updated successfully.");
    return res.redirect("/admin/messaging");
  },

  send: async (req, res) => {
    const { Message } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/messaging");

    await Message.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Sent", scheduleAt: null, sentAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/messaging");
  },

  archive: async (req, res) => {
    const { Message } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/messaging");

    await Message.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Archived", updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/messaging");
  },

  delete: async (req, res) => {
    const { Message } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/messaging");

    await Message.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/messaging");
  },

  bulkAction: async (req, res) => {
    const { Message } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/messaging");

    const patch = { updatedBy: actorUserId(req) };

    if (action === "send") {
      patch.status = "Sent";
      patch.scheduleAt = null;
      patch.sentAt = new Date();
    } else if (action === "archive") {
      patch.status = "Archived";
    } else if (action === "draft") {
      patch.status = "Draft";
      patch.scheduleAt = null;
    } else {
      return res.redirect("/admin/messaging");
    }

    await Message.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    return res.redirect("/admin/messaging");
  },
};