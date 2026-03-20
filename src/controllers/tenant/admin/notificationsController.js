const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

function safeStr(v, def = "") {
  if (v === null || v === undefined) return def;
  return String(v);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function normalizeType(type) {
  const value = safeStr(type, "info").trim().toLowerCase();
  return ["info", "success", "warning", "danger"].includes(value) ? value : "info";
}

function normalizeAudience(audience) {
  const value = safeStr(audience, "admin").trim().toLowerCase();
  return ["admin", "staff", "student", "all"].includes(value) ? value : "admin";
}

function normalizeUrl(url) {
  const value = safeStr(url).trim();
  if (!value) return "";

  if (value.startsWith("/")) return value.slice(0, 500);

  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function parseDateValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCsv(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(current);
      if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row);
  }

  return rows;
}

const notificationRules = [
  body("title").trim().isLength({ min: 2, max: 160 }).withMessage("Title is required (2-160 chars)."),
  body("message").trim().isLength({ min: 2, max: 2000 }).withMessage("Message is required (2-2000 chars)."),
  body("type").optional({ checkFalsy: true }).isIn(["info", "success", "warning", "danger"]).withMessage("Invalid type."),
  body("audience").optional({ checkFalsy: true }).isIn(["admin", "staff", "student", "all"]).withMessage("Invalid audience."),
  body("url").optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage("URL is too long."),
  body("deliverAt").optional({ checkFalsy: true }).isISO8601().withMessage("Invalid deliver date."),
  body("expiresAt").optional({ checkFalsy: true }).isISO8601().withMessage("Invalid expiry date."),
];

function buildBaseVisibilityFilter() {
  const now = new Date();
  return {
    isDeleted: { $ne: true },
    $and: [
      { $or: [{ deliverAt: null }, { deliverAt: { $exists: false } }, { deliverAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
    ],
  };
}

module.exports = {
  notificationRules,

  page: async (req, res) => {
    try {
      const { Notification } = req.models;

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = 20;

      const q = safeStr(req.query.q).trim();
      const status = safeStr(req.query.status).trim().toLowerCase();
      const type = safeStr(req.query.type).trim().toLowerCase();
      const audience = safeStr(req.query.audience).trim().toLowerCase();

      const query = buildBaseVisibilityFilter();

      if (q) {
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$and.push({
          $or: [
            { title: regex },
            { message: regex },
            { entityType: regex },
          ],
        });
      }

      if (status === "read") query.isRead = true;
      if (status === "unread") query.isRead = false;
      if (["info", "success", "warning", "danger"].includes(type)) query.type = type;
      if (["admin", "staff", "student", "all"].includes(audience)) query.audience = audience;

      const total = await Notification.countDocuments(query);
      const pages = Math.max(Math.ceil(total / limit), 1);
      const safePage = Math.min(page, pages);

      const items = await Notification.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((safePage - 1) * limit)
        .limit(limit)
        .lean();

      const baseKpiFilter = buildBaseVisibilityFilter();

      const [unreadCount, readCount] = await Promise.all([
        Notification.countDocuments({ ...baseKpiFilter, isRead: false }),
        Notification.countDocuments({ ...baseKpiFilter, isRead: true }),
      ]);

      return res.render("tenant/admin/notifications/index", {
        tenant: req.tenant || null,
        csrfToken: res.locals.csrfToken || (req.csrfToken ? req.csrfToken() : ""),
        items,
        filters: { q, status, type, audience },
        pagination: { page: safePage, pages, total, limit },
        kpis: {
          total,
          unread: unreadCount,
          read: readCount,
          scheduledLive: total,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("NOTIFICATIONS PAGE ERROR:", err);
      req.flash?.("error", "Failed to load notifications.");
      return res.status(500).redirect("/admin/notifications");
    }
  },

  create: async (req, res) => {
    try {
      const { Notification } = req.models;
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/notifications");
      }

      const title = safeStr(req.body.title).trim().slice(0, 160);
      const message = safeStr(req.body.message).trim().slice(0, 2000);
      const type = normalizeType(req.body.type);
      const audience = normalizeAudience(req.body.audience);
      const url = normalizeUrl(req.body.url);
      const deliverAt = parseDateValue(req.body.deliverAt);
      const expiresAt = parseDateValue(req.body.expiresAt);

      if (!title || !message) {
        req.flash?.("error", "Title and message are required.");
        return res.redirect("/admin/notifications");
      }

      if (deliverAt && expiresAt && expiresAt <= deliverAt) {
        req.flash?.("error", "Expiry date must be after delivery date.");
        return res.redirect("/admin/notifications");
      }

      await Notification.create({
        title,
        message,
        type,
        audience,
        url,
        deliverAt,
        expiresAt,
        isRead: false,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      req.flash?.("success", "Notification created.");
      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("CREATE NOTIFICATION ERROR:", err);
      req.flash?.("error", "Failed to create notification.");
      return res.redirect("/admin/notifications");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Notification } = req.models;

      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/notifications");
      }

      const rows = parseCsv(req.file.buffer.toString("utf8"));
      if (rows.length < 2) {
        req.flash?.("error", "CSV file is empty or invalid.");
        return res.redirect("/admin/notifications");
      }

      const headers = rows[0].map((h) => safeStr(h).trim());
      const expected = ["title", "message", "type", "audience", "url", "deliverAt", "expiresAt"];
      const map = Object.fromEntries(headers.map((h, i) => [h, i]));

      if (!expected.every((h) => Object.prototype.hasOwnProperty.call(map, h))) {
        req.flash?.("error", "Invalid CSV headers. Use: title,message,type,audience,url,deliverAt,expiresAt");
        return res.redirect("/admin/notifications");
      }

      const docs = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const title = safeStr(row[map.title]).trim().slice(0, 160);
        const message = safeStr(row[map.message]).trim().slice(0, 2000);
        if (!title || !message) continue;

        const deliverAt = parseDateValue(row[map.deliverAt]);
        const expiresAt = parseDateValue(row[map.expiresAt]);
        if (deliverAt && expiresAt && expiresAt <= deliverAt) continue;

        docs.push({
          title,
          message,
          type: normalizeType(row[map.type]),
          audience: normalizeAudience(row[map.audience]),
          url: normalizeUrl(row[map.url]),
          deliverAt,
          expiresAt,
          isRead: false,
          createdBy: req.user?._id || null,
          updatedBy: req.user?._id || null,
        });
      }

      if (!docs.length) {
        req.flash?.("error", "No valid notification rows were found in the CSV.");
        return res.redirect("/admin/notifications");
      }

      await Notification.insertMany(docs, { ordered: false });
      req.flash?.("success", `${docs.length} notification(s) imported.`);
      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("IMPORT NOTIFICATIONS CSV ERROR:", err);
      req.flash?.("error", "Failed to import CSV.");
      return res.redirect("/admin/notifications");
    }
  },

  markRead: async (req, res) => {
    try {
      const { Notification } = req.models;
      const id = safeStr(req.params.id).trim();

      if (!isValidObjectId(id)) {
        req.flash?.("error", "Invalid notification id.");
        return res.redirect("/admin/notifications");
      }

      await Notification.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { isRead: true, readAt: new Date(), updatedBy: req.user?._id || null } }
      );

      req.flash?.("success", "Notification marked as read.");
      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("MARK READ ERROR:", err);
      req.flash?.("error", "Failed to mark notification as read.");
      return res.redirect("/admin/notifications");
    }
  },

  markUnread: async (req, res) => {
    try {
      const { Notification } = req.models;
      const id = safeStr(req.params.id).trim();

      if (!isValidObjectId(id)) {
        req.flash?.("error", "Invalid notification id.");
        return res.redirect("/admin/notifications");
      }

      await Notification.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { isRead: false, readAt: null, updatedBy: req.user?._id || null } }
      );

      req.flash?.("success", "Notification marked as unread.");
      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("MARK UNREAD ERROR:", err);
      req.flash?.("error", "Failed to mark notification as unread.");
      return res.redirect("/admin/notifications");
    }
  },

  deleteOne: async (req, res) => {
    try {
      const { Notification } = req.models;
      const id = safeStr(req.params.id).trim();

      if (!isValidObjectId(id)) {
        req.flash?.("error", "Invalid notification id.");
        return res.redirect("/admin/notifications");
      }

      await Notification.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: req.user?._id || null } }
      );

      req.flash?.("success", "Notification deleted.");
      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("DELETE NOTIFICATION ERROR:", err);
      req.flash?.("error", "Failed to delete notification.");
      return res.redirect("/admin/notifications");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Notification } = req.models;
      const action = safeStr(req.body.action).trim().toLowerCase();
      const rawIds = Array.isArray(req.body.ids)
        ? req.body.ids
        : safeStr(req.body.ids)
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

      const validIds = rawIds.filter(isValidObjectId);
      if (!validIds.length) {
        req.flash?.("error", "No notifications selected.");
        return res.redirect("/admin/notifications");
      }

      if (action === "read") {
        await Notification.updateMany(
          { _id: { $in: validIds }, isDeleted: { $ne: true } },
          { $set: { isRead: true, readAt: new Date(), updatedBy: req.user?._id || null } }
        );
        req.flash?.("success", "Selected notifications marked as read.");
      } else if (action === "unread") {
        await Notification.updateMany(
          { _id: { $in: validIds }, isDeleted: { $ne: true } },
          { $set: { isRead: false, readAt: null, updatedBy: req.user?._id || null } }
        );
        req.flash?.("success", "Selected notifications marked as unread.");
      } else if (action === "delete") {
        await Notification.updateMany(
          { _id: { $in: validIds }, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: req.user?._id || null } }
        );
        req.flash?.("success", "Selected notifications deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("BULK NOTIFICATION ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/notifications");
    }
  },

  markAllRead: async (req, res) => {
    try {
      const { Notification } = req.models;
      const now = new Date();

      await Notification.updateMany(
        {
          isDeleted: { $ne: true },
          isRead: false,
          $and: [
            { $or: [{ deliverAt: null }, { deliverAt: { $exists: false } }, { deliverAt: { $lte: now } }] },
            { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
          ],
        },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
            updatedBy: req.user?._id || null,
          },
        }
      );

      req.flash?.("success", "All visible notifications marked as read.");
      return res.redirect("/admin/notifications");
    } catch (err) {
      console.error("MARK ALL READ ERROR:", err);
      req.flash?.("error", "Failed to mark all as read.");
      return res.redirect("/admin/notifications");
    }
  },
};