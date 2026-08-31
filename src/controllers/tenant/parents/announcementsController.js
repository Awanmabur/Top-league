const { getParent } = require("./_helpers");
const {
  buildParentContext,
  findVisibleAnnouncements,
  acknowledgeAnnouncement,
} = require("../../../services/tenant/announcementService");

function fmtDate(v) {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString(); } catch { return String(v); }
}

function normalizeAnnouncement(row = {}) {
  const priority = String(row.priority || "Normal").toLowerCase();
  const body = row.body || "";
  return {
    ...row,
    title: row.title || "Announcement",
    body,
    excerpt: body.length > 180 ? `${body.slice(0, 180)}...` : body,
    category: row.category || "General",
    priority,
    audience: row.audienceType || "All Parents",
    author: row.authorName || "School Administration",
    publishedAt: fmtDate(row.publishedAt || row.createdAt),
    pinned: row.priority === "Pinned",
    status: row.status || "Published",
    requiresAcknowledgement: !!row.requiresAcknowledgement,
  };
}

module.exports = {
  async index(req, res) {
    try {
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const context = await buildParentContext(req, user, parent);
      const rawAnnouncements = await findVisibleAnnouncements(req, context, { limit: 100, markRead: true });
      const announcements = rawAnnouncements.map(normalizeAnnouncement);

      const categories = [...new Set(announcements.map((a) => String(a.category || "").trim()).filter(Boolean))];
      const priorities = [...new Set(announcements.map((a) => String(a.priority || "").trim()).filter(Boolean))];

      return res.render("parents/announcements", {
        tenant: req.tenant,
        user,
        parent,
        announcements,
        filters: {
          category: String(req.query?.category || "").trim(),
          priority: String(req.query?.priority || "").trim(),
          q: String(req.query?.q || "").trim(),
        },
        options: { categories, priorities },
        error: null,
      });
    } catch (err) {
      console.error("PARENT ANNOUNCEMENTS ERROR:", err);
      return res.status(500).send("Failed to load parent announcements page");
    }
  },

  async acknowledge(req, res) {
    try {
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");
      const context = await buildParentContext(req, user, parent);
      const result = await acknowledgeAnnouncement(req, req.params.id, context);
      req.flash?.(result.ok ? "success" : "error", result.ok ? "Announcement acknowledged." : "Announcement could not be acknowledged.");
      return res.redirect("/parent/announcements");
    } catch (err) {
      console.error("PARENT ANNOUNCEMENT ACK ERROR:", err);
      req.flash?.("error", "Announcement could not be acknowledged.");
      return res.redirect("/parent/announcements");
    }
  },
};
