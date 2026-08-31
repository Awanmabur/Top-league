const { getStaffProfile } = require("./_helpers");
const { publicCalendarFilter } = require("../../../services/tenant/academicCalendarService");

module.exports = {
  index: async (req, res) => {
    try {
      const { AcademicEvent } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");
      if (!staff) return res.status(403).send("Staff profile not found.");

      const events = await AcademicEvent.find(publicCalendarFilter())
        .sort({ startDateKey: 1, startDate: 1, title: 1 })
        .limit(1000)
        .lean();

      return res.render("staff/calendar", {
        tenant: req.tenant,
        user,
        staff,
        pageTitle: "Academic Calendar",
        events: events.map((e) => ({
          ...e,
          startKey: e.startDateKey || (e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : ""),
          endKey: e.endDateKey || (e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : ""),
        })),
        error: null,
      });
    } catch (err) {
      console.error("STAFF CALENDAR ERROR:", err);
      return res.status(500).send("Failed to load academic calendar.");
    }
  },
};
