const { getParent } = require("./_helpers");

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function normalizeNotification(row = {}) {
  const type = String(row.type || row.category || "general").toLowerCase();
  const title = row.title || row.subject || "Notification";
  const body = row.body || row.message || row.content || "";
  const read = Boolean(row.readAt);

  return {
    ...row,
    title,
    body,
    excerpt: body.length > 160 ? `${body.slice(0, 160)}...` : body,
    type,
    read,
    createdLabel: fmtDate(row.createdAt || row.sentAt || row.date),
    readLabel: row.readAt ? fmtDate(row.readAt) : null,
    actionUrl: row.actionUrl || row.link || null,
    actionLabel: row.actionLabel || row.linkLabel || "Open",
  };
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-NOTIFICATIONS] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Notification } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const rawRows = Notification
        ? await Notification.find({
            deletedAt: null,
            $or: [
              { userId: user._id },
              { user: user._id },
              { email: user.email },
            ],
          })
            .sort({ readAt: 1, createdAt: -1 })
            .limit(200)
            .lean()
            .catch(() => [])
        : [];

      const rows = rawRows.map(normalizeNotification);

      const types = [
        ...new Set(rows.map((r) => String(r.type || "").trim()).filter(Boolean)),
      ];

      const unreadCount = rows.filter((r) => !r.read).length;
      const readCount = rows.filter((r) => r.read).length;

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? { id: parent._id, email: parent.email, kids: (parent.childrenStudentIds || []).length }
          : null
      );
      log("notifications:", rows.length);
      log("unread:", unreadCount);

      return res.render("tenant/parent/notifications", {
        tenant: req.tenant,
        user,
        parent,
        notifications: rows,
        stats: {
          total: rows.length,
          unread: unreadCount,
          read: readCount,
        },
        filters: {
          status: String(req.query?.status || "").trim(),
          type: String(req.query?.type || "").trim(),
          q: String(req.query?.q || "").trim(),
        },
        options: {
          types,
        },
        error: null,
      });
    } catch (err) {
      console.error("PARENT NOTIFICATIONS ERROR:", err);
      return res.status(500).send("Failed to load parent notifications page");
    }
  },

  async markRead(req, res) {
    try {
      const { Notification } = req.models || {};
      const { user } = await getParent(req);
      if (!user) return res.redirect("/login");

      const id = String(req.params?.id || "");
      if (!Notification || !id) return res.redirect("/parent/notifications");

      await Notification.updateOne(
        {
          _id: id,
          $or: [
            { userId: user._id },
            { user: user._id },
            { email: user.email },
          ],
          readAt: null,
        },
        {
          $set: { readAt: new Date() },
        }
      ).catch(() => null);

      return res.redirect("/parent/notifications");
    } catch (err) {
      console.error("PARENT NOTIFICATION MARK READ ERROR:", err);
      return res.redirect("/parent/notifications");
    }
  },

  async markAllRead(req, res) {
    try {
      const { Notification } = req.models || {};
      const { user } = await getParent(req);
      if (!user) return res.redirect("/login");

      if (!Notification) return res.redirect("/parent/notifications");

      await Notification.updateMany(
        {
          $or: [
            { userId: user._id },
            { user: user._id },
            { email: user.email },
          ],
          readAt: null,
          deletedAt: null,
        },
        {
          $set: { readAt: new Date() },
        }
      ).catch(() => null);

      return res.redirect("/parent/notifications");
    } catch (err) {
      console.error("PARENT NOTIFICATION MARK ALL READ ERROR:", err);
      return res.redirect("/parent/notifications");
    }
  },
};