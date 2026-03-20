const { getStaffProfile, isValidId } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Notification } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const items = Notification
        ? await Notification.find({ userId: user._id }).sort({ createdAt: -1 }).limit(200).lean().catch(() => [])
        : [];

      return res.render("tenant/staff/notifications", {
        tenant: req.tenant,
        user,
        staff,
        items,
        error: null
      });
    } catch (err) {
      console.error("STAFF NOTIFICATIONS LIST ERROR:", err);
      return res.status(500).send("Failed to load notifications");
    }
  },

  async read(req, res) {
    try {
      const { Notification } = req.models || {};
      const { user } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const id = req.params.id;
      if (!Notification || !isValidId(id)) return res.redirect("/staff/notifications");

      await Notification.updateOne({ _id: id, userId: user._id }, { readAt: new Date() }).catch(() => {});
      return res.redirect("/staff/notifications");
    } catch (err) {
      console.error("STAFF NOTIFICATIONS READ ERROR:", err);
      return res.status(500).send("Failed to update notification");
    }
  }
};
