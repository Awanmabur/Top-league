const { getLecturer, isValidId } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Notification } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const items = Notification
        ? await Notification.find({ userId: user._id }).sort({ createdAt: -1 }).limit(200).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/notifications", {
        tenant: req.tenant,
        user,
        lecturer,
        items,
        error: null
      });
    } catch (err) {
      console.error("LECTURER NOTIFICATIONS LIST ERROR:", err);
      return res.status(500).send("Failed to load notifications");
    }
  },

  async read(req, res) {
    try {
      const { Notification } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const id = req.params.id;
      if (!Notification || !isValidId(id)) return res.redirect("/lecturer/notifications");

      await Notification.updateOne({ _id: id, userId: user._id }, { readAt: new Date() }).catch(() => {});
      return res.redirect("/lecturer/notifications");
    } catch (err) {
      console.error("LECTURER NOTIFICATIONS READ ERROR:", err);
      return res.status(500).send("Failed to update notification");
    }
  }
};
