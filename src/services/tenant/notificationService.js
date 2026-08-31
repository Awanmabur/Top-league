function str(v) { return String(v ?? "").trim(); }
function directTargetClauses(user = {}) {
  const clauses = [];
  if (user?._id) { clauses.push({ userId: user._id }); clauses.push({ user: user._id }); }
  const email = str(user?.email).toLowerCase();
  if (email) clauses.push({ email });
  return clauses;
}
function untargetedBroadcastClause(audiences = []) {
  return { $and: [
    { $or: [{ userId: null }, { userId: { $exists: false } }] },
    { $or: [{ user: null }, { user: { $exists: false } }] },
    { $or: [{ email: null }, { email: "" }, { email: { $exists: false } }] },
    { audience: { $in: [...new Set(["all", ...audiences].filter(Boolean))] } },
  ] };
}
function portalNotificationFilter(user, audiences = [], options = {}) {
  const now = options.now || new Date();
  const targeting = [...directTargetClauses(user), untargetedBroadcastClause(audiences)];
  const filter = {
    isDeleted: { $ne: true },
    $and: [
      { $or: targeting },
      { $or: [{ deliverAt: null }, { deliverAt: { $exists: false } }, { deliverAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
    ],
  };
  if (options.unreadOnly === true) { filter.readAt = null; filter.isRead = { $ne: true }; }
  return filter;
}
function directNotificationOwnershipFilter(user) { return { $or: directTargetClauses(user) }; }
const CATEGORY_FIELDS = ["general","academics","finance","admissions","events","library","hostel","transport","discipline","messages","system"];
function normalizeCategory(v) { const x = str(v).toLowerCase(); return CATEGORY_FIELDS.includes(x) ? x : "general"; }
function inferCategory(row = {}) {
  const raw = str(row.category).toLowerCase();
  if (raw && CATEGORY_FIELDS.includes(raw)) return raw;
  const entity = str(row.entityType).toLowerCase();
  if (/invoice|payment|fee|finance|expense|payroll|scholarship/.test(entity)) return "finance";
  if (/applicant|admission|offer|intake/.test(entity)) return "admissions";
  if (/transport/.test(entity)) return "transport";
  if (/assignment|exam|result|transcript|attendance|timetable|academic_calendar/.test(entity)) return "academics";
  if (/event/.test(entity)) return "events";
  if (/library|loan|book/.test(entity)) return "library";
  if (/hostel/.test(entity)) return "hostel";
  if (/discipline/.test(entity)) return "discipline";
  if (/message|helpdesk/.test(entity)) return "messages";
  if (/system|backup|integration|security/.test(entity)) return "system";
  return "general";
}
function defaultPreference(userId = null) {
  const pref = { userId, inApp: true };
  CATEGORY_FIELDS.forEach((key) => { pref[key] = true; });
  return pref;
}
async function getPreference(models, user) {
  const { NotificationPreference } = models || {};
  if (!NotificationPreference || !user?._id) return defaultPreference(user?._id || null);
  const row = await NotificationPreference.findOne({ userId: user._id, isDeleted: { $ne: true } }).lean().catch(() => null);
  return { ...defaultPreference(user._id), ...(row || {}) };
}
function preferenceAllows(pref, row) {
  const category = inferCategory(row);
  if (category === "system") return true;
  if (pref?.inApp === false) return false;
  return pref?.[category] !== false;
}
function isDirectForUser(row, user) {
  const uid = String(user?._id || "");
  if (!uid) return false;
  if (row?.userId && String(row.userId) === uid) return true;
  if (row?.user && String(row.user) === uid) return true;
  const email = str(user?.email).toLowerCase();
  return !!email && str(row?.email).toLowerCase() === email;
}
async function loadPortalNotifications(models, user, audiences = [], options = {}) {
  const { Notification, NotificationReceipt } = models || {};
  if (!Notification || !user?._id) return [];
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 250);
  const rows = await Notification.find(portalNotificationFilter(user, audiences, options)).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  const pref = await getPreference(models, user);
  const allowed = rows.filter((row) => preferenceAllows(pref, row));
  const broadcastIds = allowed.filter((row) => !isDirectForUser(row, user)).map((row) => row._id);
  const receipts = NotificationReceipt && broadcastIds.length
    ? await NotificationReceipt.find({ notificationId: { $in: broadcastIds }, userId: user._id }).lean().catch(() => [])
    : [];
  const receiptMap = new Map(receipts.map((r) => [String(r.notificationId), r]));
  return allowed.map((row) => {
    const direct = isDirectForUser(row, user);
    const receipt = direct ? null : receiptMap.get(String(row._id));
    return {
      ...row,
      category: inferCategory(row),
      effectiveRead: direct ? !!(row.isRead || row.readAt) : !!receipt?.readAt,
      effectiveReadAt: direct ? (row.readAt || null) : (receipt?.readAt || null),
    };
  });
}
async function markPortalNotificationRead(models, user, id, audiences = []) {
  const { Notification, NotificationReceipt } = models || {};
  if (!Notification || !user?._id || !id) return null;
  const row = await Notification.findOne({ _id: id, ...portalNotificationFilter(user, audiences) }).lean().catch(() => null);
  if (!row) return null;
  const now = new Date();
  if (isDirectForUser(row, user)) {
    await Notification.updateOne({ _id: row._id, ...directNotificationOwnershipFilter(user), isDeleted: { $ne: true } }, { $set: { isRead: true, readAt: now } });
  } else if (NotificationReceipt) {
    await NotificationReceipt.updateOne({ notificationId: row._id, userId: user._id }, { $set: { readAt: now, dismissedAt: null } }, { upsert: true });
  }
  return row;
}
async function markAllPortalNotificationsRead(models, user, audiences = []) {
  const rows = await loadPortalNotifications(models, user, audiences, { limit: 250 });
  let count = 0;
  for (const row of rows) {
    if (row.effectiveRead) continue;
    await markPortalNotificationRead(models, user, row._id, audiences);
    count += 1;
  }
  return count;
}
async function savePreference(models, user, input = {}) {
  const { NotificationPreference } = models || {};
  if (!NotificationPreference || !user?._id) throw new Error("NotificationPreference model is required.");
  const $set = { inApp: input.inApp !== false, isDeleted: false, deletedAt: null };
  CATEGORY_FIELDS.forEach((key) => { $set[key] = key === "system" ? true : input[key] !== false; });
  return NotificationPreference.findOneAndUpdate({ userId: user._id }, { $set }, { upsert: true, new: true, setDefaultsOnInsert: true });
}
async function countUnreadPortalNotifications(models, user, audiences = [], options = {}) {
  const rows = await loadPortalNotifications(models, user, audiences, { ...options, limit: Math.min(Math.max(Number(options.limit || 250), 1), 250) });
  return rows.filter((row) => !row.effectiveRead).length;
}
module.exports = {
  CATEGORY_FIELDS,
  directTargetClauses,
  untargetedBroadcastClause,
  portalNotificationFilter,
  directNotificationOwnershipFilter,
  normalizeCategory,
  inferCategory,
  getPreference,
  preferenceAllows,
  isDirectForUser,
  loadPortalNotifications,
  markPortalNotificationRead,
  markAllPortalNotificationsRead,
  countUnreadPortalNotifications,
  savePreference,
};
