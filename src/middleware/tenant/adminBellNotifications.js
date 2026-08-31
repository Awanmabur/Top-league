const BELL_CACHE = new Map();
const BELL_TTL_MS = 2 * 60 * 1000;

function cacheKey(req) {
  const tenantCode = req.tenant?.code || req.tenant?._id || "tenant";
  const userId = req.user?.userId || req.user?._id || "";
  return userId ? `${tenantCode}:${userId}` : "";
}

function getCachedBell(req) {
  const key = cacheKey(req);
  if (!key) return null;
  const hit = BELL_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    BELL_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCachedBell(req, value) {
  const key = cacheKey(req);
  if (!key) return;
  BELL_CACHE.set(key, { value, exp: Date.now() + BELL_TTL_MS });
}

module.exports = async function adminBellNotifications(req, res, next) {
  try {
    const { Notification } = req.models || {};
    if (!Notification || !req.user) {
      res.locals.notifBell = { unread: 0, items: [] };
      return next();
    }

    const cached = getCachedBell(req);
    if (cached) {
      res.locals.notifBell = cached;
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
        .select("title message type url isRead createdAt")
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    res.locals.notifBell = { unread, items };
    setCachedBell(req, res.locals.notifBell);
    return next();
  } catch (err) {
    // never block the page
    res.locals.notifBell = { unread: 0, items: [] };
    return next();
  }
};