const {
  getStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");

module.exports = {
  events: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Event, Announcement } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const meta = academicMeta(student);

      const events = Event
        ? await Event.find({})
            .sort({ date: 1, startDate: 1, startsAt: 1, createdAt: -1 })
            .limit(50)
            .lean()
            .catch(() => [])
        : [];

      const announcements = Announcement
        ? await Announcement.find({})
            .sort({ createdAt: -1 })
            .limit(8)
            .lean()
            .catch(() => [])
        : [];

      const rows = events.map((e) => ({
        id: String(e._id),
        date: e.date || e.startDate || e.startsAt || null,
        title: e.title || e.name || "Event",
        organizer: e.organizer || e.department || e.faculty || "",
        type: e.type || e.category || "Event",
        location: e.location || e.venue || "Campus",
        time:
          e.time ||
          `${e.startTime || ""}${e.endTime ? `–${e.endTime}` : ""}`.trim() ||
          "TBA",
        description: e.description || e.summary || "",
      }));

      return renderView(req, res, "tenant/student/events", {
        pageTitle: "Events",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        events: rows,
        announcements: announcements.map((a) => ({
          title: a.title || "Announcement",
          message: a.message || a.body || "",
          createdAt: a.createdAt || null,
        })),
      });
    } catch (err) {
      return res.status(500).send("Failed to load events: " + err.message);
    }
  },
};