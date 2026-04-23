const { getParent } = require("./_helpers");

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}

function normalizeAnnouncement(row = {}) {
  const priority = String(row.priority || row.level || "normal").toLowerCase();
  const audience = row.audience || row.target || "All parents";
  const body = row.body || row.message || row.content || "";
  const title = row.title || row.subject || "Announcement";

  return {
    ...row,
    title,
    body,
    excerpt: body.length > 180 ? `${body.slice(0, 180)}...` : body,
    category: row.category || row.type || "General",
    priority,
    audience,
    author: row.authorName || row.createdByName || row.postedBy || "School Administration",
    publishedAt: fmtDate(row.publishedAt || row.createdAt),
    pinned: Boolean(row.pinned || row.isPinned || priority === "high" || priority === "urgent"),
    status: row.status || "published",
  };
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-ANNOUNCEMENTS] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Announcement } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const rawAnnouncements = Announcement
        ? await Announcement.find({
            $or: [
              { deletedAt: null },
              { deletedAt: { $exists: false } },
            ],
          })
            .sort({ pinned: -1, publishedAt: -1, createdAt: -1 })
            .limit(100)
            .lean()
            .catch(() => [])
        : [];

      const announcements = rawAnnouncements.map(normalizeAnnouncement);

      const categories = [
        ...new Set(announcements.map((a) => String(a.category || "").trim()).filter(Boolean)),
      ];

      const priorities = [
        ...new Set(announcements.map((a) => String(a.priority || "").trim()).filter(Boolean)),
      ];

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
      log("announcements:", announcements.length);

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
        options: {
          categories,
          priorities,
        },
        error: null,
      });
    } catch (err) {
      console.error("PARENT ANNOUNCEMENTS ERROR:", err);
      return res.status(500).send("Failed to load parent announcements page");
    }
  },
};