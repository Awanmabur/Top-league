const { getStaffProfile } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Announcement } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const items = Announcement
        ? await Announcement.find({}).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("staff/announcements", {
        tenant: req.tenant,
        user,
        staff,
        items,
        pageTitle: "Announcements",
        error: null
      });
    } catch (err) {
      console.error("STAFF ANNOUNCEMENTS ERROR:", err);
      return res.status(500).send("Failed to load announcements");
    }
  }
};
