const { getStaffProfile } = require("./_helpers");

module.exports = {
  async timetable(req, res) {
    try {
      const { TimetableEntry } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const items = (staff && TimetableEntry)
        ? await TimetableEntry.find({ staffId: staff._id }).sort({ day: 1, startTime: 1 }).lean().catch(() => [])
        : [];

      return res.render("staff/timetable", {
        tenant: req.tenant,
        user,
        staff,
        items,
        pageTitle: "Timetable",
        error: null
      });
    } catch (err) {
      console.error("STAFF TIMETABLE ERROR:", err);
      return res.status(500).send("Failed to load timetable");
    }
  }
};
