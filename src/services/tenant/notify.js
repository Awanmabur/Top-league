function safeStr(v, def = "") {
  if (v === null || v === undefined) return def;
  return String(v);
}

/**
 * Create a notification in tenant DB.
 * Usage:
 *   await notify(req, { audience:"admin", title:"Invoice created", message:"...", url:"/admin/invoices/..." })
 */
async function notify(req, payload) {
  const { Notification } = req.models || {};
  if (!Notification) return null;

  const doc = await Notification.create({
    audience: payload.audience || "admin",
    userId: payload.userId || null,
    title: safeStr(payload.title).trim(),
    message: safeStr(payload.message).trim(),
    type: payload.type || "info",
    url: payload.url || "",
    entityType: payload.entityType || "",
    entityId: payload.entityId || null,
    deliverAt: payload.deliverAt || null,
    expiresAt: payload.expiresAt || null,
    createdBy: req.user?._id || null,
  });

  return doc;
}

module.exports = { notify };
