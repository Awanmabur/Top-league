const {
  getStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");

module.exports = {
  notifications: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Notification, Announcement } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const meta = academicMeta(student);

      const notifications = Notification
        ? await Notification.find({
            $or: [
              { userId: user._id },
              { studentId: student?._id || null },
              { audience: { $in: ["all", "students"] } },
            ],
          })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean()
            .catch(() => [])
        : [];

      const announcements = Announcement
        ? await Announcement.find({})
            .sort({ createdAt: -1 })
            .limit(10)
            .lean()
            .catch(() => [])
        : [];

      const items = [
        ...notifications.map((n) => ({
          id: String(n._id),
          title: n.title || "Notification",
          message: n.message || n.body || "",
          category: n.category || n.type || "notification",
          read: !!(n.read || n.isRead),
          createdAt: n.createdAt || null,
          source: "notification",
        })),
        ...announcements.map((a) => ({
          id: String(a._id),
          title: a.title || "Announcement",
          message: a.message || a.body || a.content || "",
          category: "announcement",
          read: false,
          createdAt: a.createdAt || null,
          source: "announcement",
        })),
      ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      return renderView(req, res, "tenant/student/notifications", {
        pageTitle: "Notifications",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        notifications: items,
        stats: {
          total: items.length,
          unread: items.filter((i) => !i.read).length,
          announcements: items.filter((i) => i.source === "announcement").length,
        },
      });
    } catch (err) {
      return res.status(500).send("Failed to load notifications: " + err.message);
    }
  },
};