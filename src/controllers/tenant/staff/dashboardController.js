const { buildStaffContext, findVisibleAnnouncements } = require("../../../services/tenant/announcementService");
const { getStaffProfile } = require("./_helpers");
const { countUnreadPortalNotifications, portalNotificationFilter } = require("../../../services/tenant/notificationService");
// countUnreadPortalNotifications applies this private-target visibility contract internally.
void portalNotificationFilter;

module.exports = {
  async dashboard(req, res) {
    try {
      const { Announcement, Notification, TimetableEntry, LeaveRequest, PayrollRun, PayrollItem } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const unreadPromise = Notification
        ? countUnreadPortalNotifications(req.models, user, ["staff"], { limit: 250 }).catch(() => 0)
        : Promise.resolve(0);
      const announcementsPromise = Announcement
        ? buildStaffContext(req, user, staff)
            .then((context) => findVisibleAnnouncements(req, context, { limit: 6, markRead: true }))
            .catch(() => [])
        : Promise.resolve([]);
      const timetablePromise = (staff && TimetableEntry)
        ? TimetableEntry.countDocuments({ teacher: staff._id, status: "active", migrationQuarantinedAt: null }).catch(() => 0)
        : Promise.resolve(0);
      const pendingLeavePromise = (staff && LeaveRequest)
        ? LeaveRequest.countDocuments({ staffId: staff._id, status: "Pending" }).catch(() => 0)
        : Promise.resolve(0);
      const payslipsPromise = (staff && PayrollRun && PayrollItem)
        ? PayrollRun.find({ status: { $in: ["Approved", "Closed"] }, isDeleted: { $ne: true } })
            .select("_id")
            .lean()
            .catch(() => [])
            .then((visibleRuns) => {
              if (!visibleRuns.length) return [];
              return PayrollItem.find({
                staffId: staff._id,
                payrollRunId: { $in: visibleRuns.map((r) => r._id) },
                status: { $in: ["Processed", "Paid", "Held"] },
                isDeleted: { $ne: true },
              })
                .populate("payrollRunId", "title periodLabel month year status")
                .sort({ createdAt: -1 })
                .limit(3)
                .lean()
                .catch(() => []);
            })
        : Promise.resolve([]);

      const [unread, announcements, timetableCount, pendingLeave, payslips] = await Promise.all([
        unreadPromise,
        announcementsPromise,
        timetablePromise,
        pendingLeavePromise,
        payslipsPromise,
      ]);

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
