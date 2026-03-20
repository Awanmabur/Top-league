const { getLecturer, renderError } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Announcement } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const items = Announcement
        ? await Announcement.find({}).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/announcements", {
        tenant: req.tenant,
        user,
        lecturer,
        items,
        error: null
      });
    } catch (err) {
      console.error("LECTURER ANNOUNCEMENTS LIST ERROR:", err);
      return res.status(500).send("Failed to load announcements");
    }
  },

  async create(req, res) {
    try {
      const { Announcement } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");
      if (!Announcement) return res.status(500).send("Announcement model missing");

      const title = String(req.body.title || "").trim();
      const body = String(req.body.body || "").trim();

      if (!title || !body) {
        return renderError(res, "tenant/lecturer/announcements", {
          tenant: req.tenant, user, lecturer, items: []
        }, "Title and message are required.");
      }

      await Announcement.create({
        title,
        body,
        createdByUserId: user._id,
        createdAt: new Date()
      });

      return res.redirect("/lecturer/announcements");
    } catch (err) {
      console.error("LECTURER ANNOUNCEMENTS CREATE ERROR:", err);
      return res.status(500).send("Failed to create announcement");
    }
  }
};
