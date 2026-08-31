const { buildParentContext, findVisibleAnnouncements } = require("../../../services/tenant/announcementService");
const { getParent, loadLinkedChildren } = require("./_helpers");
const { countUnreadPortalNotifications, portalNotificationFilter } = require("../../../services/tenant/notificationService");
// countUnreadPortalNotifications applies this private-target visibility contract internally.
void portalNotificationFilter;

module.exports = {
  async dashboard(req, res) {
    try {
      const { Notification, Announcement, Student } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const unreadPromise = Notification
        ? countUnreadPortalNotifications(req.models, user, ["parent"], { limit: 250 }).catch(() => 0)
        : Promise.resolve(0);
      const announcementsPromise = Announcement
        ? buildParentContext(req, user, parent)
            .then((context) => findVisibleAnnouncements(req, context, { limit: 6, markRead: true }))
            .catch(() => [])
        : Promise.resolve([]);
      const childrenPromise = loadLinkedChildren(req, parent);

      const [unread, announcements, children] = await Promise.all([
        unreadPromise,
        announcementsPromise,
        childrenPromise,
      ]);


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
