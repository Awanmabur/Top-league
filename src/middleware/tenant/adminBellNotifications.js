module.exports = async function adminBellNotifications(req, res, next) {
  try {
    const { Notification } = req.models || {};
    if (!Notification) {
      res.locals.notifBell = { unread: 0, items: [] };
      return next();
    }

    const now = new Date();

    const base = {
      isDeleted: { $ne: true },
      $or: [{ deliverAt: null }, { deliverAt: { $lte: now } }],
      $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
    };

    // Visible to admins: audience admin/all + personal to me (or global)
    const visible = {
      ...base,
      $and: [
        ...(base.$and || []),
        {
          audience: { $in: ["admin", "all"] },
        },
        {
          $or: [
            { userId: null },
            { userId: req.user?._id || null },
          ],
        },
      ],
    };

    const [unread, items] = await Promise.all([
      Notification.countDocuments({ ...visible, isRead: false }),
      Notification.find(visible)
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    res.locals.notifBell = { unread, items };
    return next();
  } catch (err) {
    // never block the page
    res.locals.notifBell = { unread: 0, items: [] };
    return next();
  }
};
