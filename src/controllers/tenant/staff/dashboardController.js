const { getStaffProfile } = require("./_helpers");

module.exports = {
  async dashboard(req, res) {
    try {
      const { Announcement, Notification, TimetableEntry, LeaveRequest, PayrollItem } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const unread = Notification
        ? await Notification.countDocuments({ userId: user._id, readAt: null }).catch(() => 0)
        : 0;

      const announcements = Announcement
        ? await Announcement.find({}).sort({ createdAt: -1 }).limit(6).lean().catch(() => [])
        : [];

      const timetableCount = (staff && TimetableEntry)
        ? await TimetableEntry.countDocuments({ staffId: staff._id }).catch(() => 0)
        : 0;

      const pendingLeave = (staff && LeaveRequest)
        ? await LeaveRequest.countDocuments({ staffId: staff._id, status: "pending" }).catch(() => 0)
        : 0;

      const payslips = (staff && PayrollItem)
        ? await PayrollItem.find({ staffId: staff._id }).sort({ createdAt: -1 }).limit(3).lean().catch(() => [])
        : [];

      return res.render("staff/dashboard", {
        tenant: req.tenant,
        user,
        staff,
        announcements,
        stats: { unread, timetableCount, pendingLeave },
        payslips,
        pageTitle: "Staff Dashboard",
        error: staff ? null : "Staff profile not found. Contact admin."
      });
    } catch (err) {
      console.error("STAFF DASHBOARD ERROR:", err);
      return res.status(500).send("Failed to load staff dashboard");
    }
  }
};
