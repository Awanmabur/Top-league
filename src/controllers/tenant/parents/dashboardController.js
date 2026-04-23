const { getParent } = require("./_helpers");

module.exports = {
  async dashboard(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-DASH] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Notification, Announcement, Student } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const unread = Notification
        ? await Notification.countDocuments({
            userId: user._id,
            readAt: null,
          }).catch(() => 0)
        : 0;

      const announcements = Announcement
        ? await Announcement.find({})
            .sort({ createdAt: -1 })
            .limit(6)
            .lean()
            .catch(() => [])
        : [];

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select(
                "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status photoUrl guardianName guardianPhone guardianEmail attendanceRate feeBalance balance averageScore avgScore cgpa latestResult latestAnnouncement lastAttendanceDate nextEvent campus homeroomTeacher parentRelationship"
              )
              .populate({
                path: "program",
                select: "code name title level faculty",
              })
              .populate({
                path: "classGroup",
                select: "code name title",
              })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      log(
        "req.user:",
        req.user
          ? { id: req.user._id || req.user.userId || req.user.id, roles: req.user.roles }
          : null
      );
      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? {
              id: parent._id,
              email: parent.email,
              kids: (parent.childrenStudentIds || []).length,
            }
          : null
      );
      log("children:", children.length);

      return res.render("parents/dashboard", {
        tenant: req.tenant,
        user,
        parent,
        children,
        announcements,
        stats: {
          unread,
          children: children.length,
        },
        error: parent ? null : "Parent profile not found. Contact admin.",
      });
    } catch (err) {
      console.error("PARENT DASHBOARD ERROR:", err);
      return res.status(500).send("Failed to load parent dashboard");
    }
  },
};
