const { getLecturer } = require("./_helpers");

module.exports = {
  async timetable(req, res) {
    try {
      const { Timetable } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const items = (lecturer && Timetable)
        ? await Timetable.find({ staffId: lecturer._id }).sort({ day: 1, startTime: 1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/timetable", {
        tenant: req.tenant,
        user,
        lecturer,
        items,
        error: null
      });
    } catch (err) {
      console.error("LECTURER TIMETABLE ERROR:", err);
      return res.status(500).send("Failed to load timetable");
    }
  }
};
