const { getStaffProfile } = require("./_helpers");
const {
  buildStaffContext,
  findVisibleAnnouncements,
  acknowledgeAnnouncement,
} = require("../../../services/tenant/announcementService");

module.exports = {
  async list(req, res) {
    try {
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const context = await buildStaffContext(req, user, staff);
      const items = await findVisibleAnnouncements(req, context, { limit: 100, markRead: true });

      return res.render("staff/announcements", {
        tenant: req.tenant,
        user,
        staff,
        items,
        pageTitle: "Announcements",
        error: null,
      });
    } catch (err) {
      console.error("STAFF ANNOUNCEMENTS ERROR:", err);
      return res.status(500).send("Failed to load announcements");
    }
  },

  async acknowledge(req, res) {
    try {
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");
      const context = await buildStaffContext(req, user, staff);
      const result = await acknowledgeAnnouncement(req, req.params.id, context);
      req.flash?.(result.ok ? "success" : "error", result.ok ? "Announcement acknowledged." : "Announcement could not be acknowledged.");
      return res.redirect("/staff/announcements");
    } catch (err) {
      console.error("STAFF ANNOUNCEMENT ACK ERROR:", err);
      req.flash?.("error", "Announcement could not be acknowledged.");
      return res.redirect("/staff/announcements");
    }
  },
};
