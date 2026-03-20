const { getLecturer } = require("./_helpers");

module.exports = {
  async dashboard(req, res) {
    try {
      const { ClassSection, Announcement, Notification } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const classes = (lecturer && ClassSection)
        ? await ClassSection.find({ lecturerStaffId: lecturer._id }).sort({ name: 1 }).lean().catch(() => [])
        : [];

      const announcements = Announcement
        ? await Announcement.find({}).sort({ createdAt: -1 }).limit(6).lean().catch(() => [])
        : [];

      const unread = Notification
        ? await Notification.countDocuments({ userId: user._id, readAt: null }).catch(() => 0)
        : 0;

      return res.render("tenant/lecturer/dashboard", {
        tenant: req.tenant,
        user,
        lecturer,
        classes,
        announcements,
        stats: { classes: classes.length, unread },
        error: lecturer ? null : "Lecturer profile not found. Contact admin."
      });
    } catch (err) {
      console.error("LECTURER DASHBOARD ERROR:", err);
      return res.status(500).send("Failed to load lecturer dashboard");
    }
  }
};
