const mongoose = require("mongoose");
const { sendMail } = require("../../utils/mailer");
const {
  STAFF_ROLES,
  normalizeAudienceType: normalizeAnnouncementAudience,
  resolveDirectRecipients: resolveAnnouncementRecipients,
} = require("./announcementService");

function str(v) {
  return String(v ?? "").trim();
}

function escapeRegex(v) {
  return str(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAudienceType(v) {
  const value = normalizeAnnouncementAudience(v);
  const allowed = [
    "All Students",
    "All Staff",
    "Specific Department",
    "Specific Program",
    "Specific Subject",
    "Year/Cohort",
  ];
  return allowed.includes(value) ? value : "All Students";
}

function userName(user = {}) {
  return str(user.fullName) || [user.firstName, user.lastName].map(str).filter(Boolean).join(" ") || str(user.email) || "Portal User";
}

function userRoles(user = {}) {
  return Array.isArray(user.roles) ? user.roles.map((r) => str(r).toLowerCase()).filter(Boolean) : [];
}

function primaryRole(user = {}) {
  const roles = userRoles(user);
  if (roles.includes("student")) return "Student";
  if (roles.some((r) => STAFF_ROLES.includes(r))) return "Staff";
  if (roles.includes("parent")) return "Parent";
  if (roles.includes("admin")) return "Admin";
  return roles[0] || "User";
}

function notificationAudienceFor(user = {}) {
  const role = primaryRole(user).toLowerCase();
  if (role === "student") return "student";
  if (role === "parent") return "parent";
  if (role === "admin") return "admin";
  return "staff";
}

function messageUrlFor(user = {}) {
  const role = notificationAudienceFor(user);
  if (role === "student") return "/student/notifications";
  if (role === "parent") return "/parent/notifications";
  if (role === "staff") return "/staff/notifications";
  return "/admin/notifications";
}

function recipientAllowedForAudience(user = {}, audienceType) {
  const roles = userRoles(user);
  const type = normalizeAudienceType(audienceType);
  if (type === "All Staff") return roles.some((r) => STAFF_ROLES.includes(r));
  if (type === "Specific Department") {
    return roles.includes("student") || roles.some((r) => STAFF_ROLES.includes(r));
  }
  return roles.includes("student");
}

async function resolveMessageRecipients(req, message) {
  const resolved = await resolveAnnouncementRecipients(req, {
    audienceType: normalizeAudienceType(message?.audienceType),
    audienceValue: message?.audienceValue,
  });
  const byId = new Map();
  for (const user of resolved || []) {
    if (!user?._id || !recipientAllowedForAudience(user, message?.audienceType)) continue;
    byId.set(String(user._id), user);
  }
  return [...byId.values()];
}

async function syncMessageStats(req, messageId) {
  const { Message, MessageRecipient } = req.models || {};
  if (!Message || !MessageRecipient || !messageId) return null;

  const aggregateMessageId = mongoose.Types.ObjectId.isValid(String(messageId))
    ? new mongoose.Types.ObjectId(String(messageId))
    : messageId;
  const rows = await MessageRecipient.aggregate([
    { $match: { messageId: aggregateMessageId } },
    {
      $group: {
        _id: null,
        recipients: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $in: ["$status", ["Delivered", "Opened"]] }, 1, 0] } },
        opened: { $sum: { $cond: [{ $eq: ["$status", "Opened"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", "Failed"] }, 1, 0] } },
      },
    },
  ]);
  const row = rows[0] || {};
  const stats = {
    recipients: Number(row.recipients || 0),
    delivered: Number(row.delivered || 0),
    opened: Number(row.opened || 0),
    failed: Number(row.failed || 0),
  };
  await Message.updateOne({ _id: messageId }, { $set: { stats } });
  return stats;
}

async function materializeMessageRecipients(req, message) {
  const { MessageRecipient, Notification } = req.models || {};
  if (!MessageRecipient || !message?._id) return [];

  const recipients = await resolveMessageRecipients(req, message);
  const ids = recipients.map((user) => user?._id).filter(Boolean);
  const staleFilter = { messageId: message._id };
  const staleNotificationFilter = { entityType: "Message", entityId: message._id, isDeleted: { $ne: true } };
  if (ids.length) {
    staleFilter.userId = { $nin: ids };
    staleNotificationFilter.userId = { $nin: ids };
  }
  await MessageRecipient.deleteMany(staleFilter);
  if (Notification) {
    await Notification.updateMany(
      staleNotificationFilter,
      { $set: { isDeleted: true, deletedAt: new Date() } }
    ).catch(() => {});
  }

  if (!recipients.length) {
    await syncMessageStats(req, message._id);
    return [];
  }

  await MessageRecipient.bulkWrite(
    recipients.map((user) => ({
      updateOne: {
        filter: { messageId: message._id, userId: user._id },
        update: {
          $setOnInsert: {
            messageId: message._id,
            userId: user._id,
            status: "Pending",
          },
          $set: {
            name: userName(user),
            email: str(user.email).toLowerCase(),
            role: primaryRole(user),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  await syncMessageStats(req, message._id);
  return recipients;
}

async function markRecipientDelivered(req, messageId, userId, now = new Date()) {
  const { MessageRecipient } = req.models || {};
  if (!MessageRecipient) return;
  await MessageRecipient.updateOne(
    { messageId, userId, status: { $ne: "Opened" } },
    { $set: { status: "Delivered", deliveredAt: now } }
  );
}

async function markRecipientFailedIfNoDelivery(req, messageId, userId) {
  const { MessageRecipient } = req.models || {};
  if (!MessageRecipient) return;
  const row = await MessageRecipient.findOne({ messageId, userId }).lean();
  if (!row || row.status === "Opened" || row.status === "Delivered") return;
  const portalFailed = ["Not Requested", "Failed"].includes(row.portalDeliveryStatus);
  const emailFailed = ["Not Requested", "Failed"].includes(row.emailDeliveryStatus);
  if (portalFailed && emailFailed) {
    await MessageRecipient.updateOne({ _id: row._id }, { $set: { status: "Failed" } });
  }
}

async function deliverPortalChannel(req, message, recipients) {
  const { Notification, MessageRecipient } = req.models || {};
  if (!message?.channels?.portal || !Notification || !MessageRecipient) return { delivered: 0, failed: 0 };
  const users = (recipients || []).filter((user) => user?._id);
  if (!users.length) return { delivered: 0, failed: 0 };
  const ids = users.map((user) => user._id);
  const now = new Date();

  await MessageRecipient.updateMany(
    { messageId: message._id, userId: { $in: ids } },
    { $set: { portalDeliveryStatus: "Pending" } },
  );

  try {
    await Notification.bulkWrite(
      users.map((user) => ({
        updateOne: {
          filter: {
            entityType: "Message",
            entityId: message._id,
            entityAction: "message_delivery",
            userId: user._id,
            isDeleted: { $ne: true },
          },
          update: {
            $set: {
              audience: notificationAudienceFor(user),
              userId: user._id,
              title: message.subject,
              message: str(message.body).slice(0, 5000),
              type: message.priority === "Important" ? "warning" : "info",
              url: messageUrlFor(user),
              entityType: "Message",
              entityId: message._id,
              entityAction: "message_delivery",
            },
            $setOnInsert: { createdBy: req.user?.userId || req.user?._id || null },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    await MessageRecipient.updateMany(
      { messageId: message._id, userId: { $in: ids } },
      {
        $set: { portalDeliveryStatus: "Delivered", portalDeliveredAt: now },
      },
    );
    await MessageRecipient.updateMany(
      { messageId: message._id, userId: { $in: ids }, status: { $ne: "Opened" } },
      { $set: { status: "Delivered", deliveredAt: now } },
    );
    return { delivered: users.length, failed: 0 };
  } catch (error) {
    await MessageRecipient.updateMany(
      { messageId: message._id, userId: { $in: ids } },
      { $set: { portalDeliveryStatus: "Failed" } },
    ).catch(() => {});
    return { delivered: 0, failed: users.length };
  }
}

function escapeHtml(v) {
  return str(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function runBounded(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const out = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(Number(limit) || 1, list.length)) }, () => (async () => {
    while (true) {
      const index = next++;
      if (index >= list.length) return;
      out[index] = await worker(list[index], index);
    }
  })());
  await Promise.all(workers);
  return out;
}

async function deliverEmailChannel(req, message, recipients) {
  const { MessageRecipient } = req.models || {};
  if (!message?.channels?.email || !MessageRecipient) return { sent: 0, failed: 0 };
  const users = (recipients || []).filter((user) => user?._id);
  if (!users.length) return { sent: 0, failed: 0 };
  const ids = users.map((user) => user._id);
  const existing = await MessageRecipient.find({ messageId: message._id, userId: { $in: ids } })
    .select("userId emailDeliveryStatus")
    .lean();
  const byUser = new Map(existing.map((row) => [String(row.userId), row]));
  const pending = users.filter((user) => byUser.get(String(user._id))?.emailDeliveryStatus !== "Sent");
  if (!pending.length) return { sent: 0, failed: 0 };

  await MessageRecipient.updateMany(
    { messageId: message._id, userId: { $in: pending.map((user) => user._id) } },
    { $set: { emailDeliveryStatus: "Pending", emailError: "" } },
  );

  const subject = message.subject;
  const text = str(message.body);
  const html = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  const concurrency = Math.max(1, Math.min(Number(process.env.MESSAGE_EMAIL_CONCURRENCY || 5), 10));
  const outcomes = await runBounded(pending, concurrency, async (user) => {
    const email = str(user.email).toLowerCase();
    if (!email) return { user, ok: false, error: "Recipient has no email address." };
    try {
      await sendMail({ to: email, subject, text, html, replyTo: str(message.replyTo) || undefined, fromName: str(message.senderName) || undefined });
      return { user, ok: true, at: new Date() };
    } catch (error) {
      return { user, ok: false, error: str(error?.message).slice(0, 500) || "Email delivery failed." };
    }
  });

  const ops = outcomes.map(({ user, ok, at, error }) => ({
    updateOne: {
      filter: { messageId: message._id, userId: user._id },
      update: ok
        ? { $set: { emailDeliveryStatus: "Sent", emailDeliveredAt: at, emailError: "" } }
        : { $set: { emailDeliveryStatus: "Failed", emailError: error } },
    },
  }));
  if (ops.length) await MessageRecipient.bulkWrite(ops, { ordered: false });

  const successfulIds = outcomes.filter((row) => row.ok).map((row) => row.user._id);
  if (successfulIds.length) {
    const now = new Date();
    await MessageRecipient.updateMany(
      { messageId: message._id, userId: { $in: successfulIds }, status: { $ne: "Opened" } },
      { $set: { status: "Delivered", deliveredAt: now } },
    );
  }
  await MessageRecipient.updateMany(
    {
      messageId: message._id,
      status: { $nin: ["Opened", "Delivered"] },
      portalDeliveryStatus: { $in: ["Not Requested", "Failed"] },
      emailDeliveryStatus: { $in: ["Not Requested", "Failed"] },
    },
    { $set: { status: "Failed" } },
  );

  const sent = outcomes.filter((row) => row.ok).length;
  return { sent, failed: outcomes.length - sent };
}

async function dispatchMessage(req, message, now = new Date(), options = {}) {
  if (!message) return { ok: false, reason: "missing", recipients: 0 };
  if (options.updatedBy !== undefined) message.updatedBy = options.updatedBy;

  const recipients = await materializeMessageRecipients(req, message);
  if (!recipients.length) {
    message.status = "Failed";
    message.scheduleAt = null;
    message.scheduleClaimedAt = null;
    await message.save();
    await syncMessageStats(req, message._id);
    return { ok: false, reason: "no_recipients", recipients: 0 };
  }

  const portal = await deliverPortalChannel(req, message, recipients);
  const email = await deliverEmailChannel(req, message, recipients);
  const stats = await syncMessageStats(req, message._id);

  // Commit Sent only after recipient/channel work completes. Scheduled jobs therefore
  // remain recoverable by the lease if the process dies during delivery.
  message.status = "Sent";
  message.scheduleAt = null;
  message.scheduleClaimedAt = null;
  message.sentAt = message.sentAt || now;
  await message.save();
  return { ok: true, recipients: recipients.length, portal, email, stats };
}

async function processDueMessages(req, now = new Date()) {
  const { Message } = req.models || {};
  if (!Message) return 0;
  const leaseMs = Math.max(60_000, Number(process.env.MESSAGE_SCHEDULE_LEASE_MS || 300_000));
  const staleClaim = new Date(now.getTime() - leaseMs);
  let sent = 0;

  for (let i = 0; i < 100; i += 1) {
    const message = await Message.findOneAndUpdate(
      {
        isDeleted: { $ne: true },
        status: "Scheduled",
        scheduleAt: { $ne: null, $lte: now },
        $or: [
          { scheduleClaimedAt: null },
          { scheduleClaimedAt: { $exists: false } },
          { scheduleClaimedAt: { $lt: staleClaim } },
        ],
      },
      { $set: { scheduleClaimedAt: now } },
      { new: true, sort: { scheduleAt: 1, createdAt: 1 } }
    );
    if (!message) break;

    try {
      const result = await dispatchMessage(req, message, now);
      if (result.ok) sent += 1;
    } catch (err) {
      await Message.updateOne(
        { _id: message._id, status: "Scheduled" },
        { $set: { scheduleClaimedAt: null } }
      ).catch(() => {});
      throw err;
    }
  }
  return sent;
}

async function getMessageRecipients(req, messageIds = []) {
  const { MessageRecipient } = req.models || {};
  if (!MessageRecipient || !messageIds.length) return new Map();
  const rows = await MessageRecipient.find({ messageId: { $in: messageIds } })
    .sort({ status: 1, name: 1, createdAt: 1 })
    .lean();
  const map = new Map();
  for (const row of rows) {
    const key = String(row.messageId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function resendOrRemind(req, message) {
  const { MessageRecipient, Notification } = req.models || {};
  if (!message?._id || !MessageRecipient) return { reminded: 0, emailed: 0, failedEmails: 0 };
  await materializeMessageRecipients(req, message);
  const rows = await MessageRecipient.find({ messageId: message._id, status: { $ne: "Opened" } }).lean();
  const now = new Date();
  let reminded = 0;

  if (Notification && message.channels?.portal) {
    for (const row of rows) {
      try {
        await Notification.create({
          audience: String(row.role || "").toLowerCase() === "student" ? "student" : "staff",
          userId: row.userId,
          title: `Reminder: ${message.subject}`,
          message: message.body,
          type: message.priority === "Important" ? "warning" : "info",
          url: String(row.role || "").toLowerCase() === "student" ? "/student/notifications" : "/staff/notifications",
          entityType: "Message",
          entityId: message._id,
          entityAction: "message_reminder",
          createdBy: req.user?.userId || req.user?._id || null,
        });
        reminded += 1;
      } catch {}
    }
  }

  let emailed = 0;
  let failedEmails = 0;
  if (message.channels?.email) {
    const subject = `Reminder: ${message.subject}`;
    const text = str(message.body);
    const html = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    for (const row of rows) {
      if (!row.email) continue;
      try {
        await sendMail({ to: row.email, subject, text, html, replyTo: str(message.replyTo) || undefined, fromName: str(message.senderName) || undefined });
        emailed += 1;
      } catch {
        failedEmails += 1;
      }
    }
  }

  if (rows.length) {
    await MessageRecipient.updateMany(
      { _id: { $in: rows.map((row) => row._id) } },
      { $inc: { reminderCount: 1 }, $set: { lastRemindedAt: now } }
    );
  }
  return { reminded, emailed, failedEmails };
}

async function markMessageOpened(req, messageId, userId, now = new Date()) {
  const { MessageRecipient } = req.models || {};
  if (!MessageRecipient || !messageId || !userId) return false;
  const result = await MessageRecipient.updateOne(
    { messageId, userId, status: { $ne: "Opened" } },
    { $set: { status: "Opened", openedAt: now } }
  );
  if (result.modifiedCount) await syncMessageStats(req, messageId);
  return !!result.modifiedCount;
}

async function markMessageOpenedFromNotification(req, notification, user, now = new Date()) {
  if (!notification || notification.entityType !== "Message" || !notification.entityId || !user?._id) return false;
  return markMessageOpened(req, notification.entityId, user._id, now);
}

module.exports = {
  escapeRegex,
  normalizeAudienceType,
  resolveMessageRecipients,
  materializeMessageRecipients,
  deliverPortalChannel,
  deliverEmailChannel,
  dispatchMessage,
  processDueMessages,
  getMessageRecipients,
  resendOrRemind,
  markMessageOpened,
  markMessageOpenedFromNotification,
  syncMessageStats,
};
