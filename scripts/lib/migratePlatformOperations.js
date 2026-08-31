const { DEFAULT_CONFIG, normalizeGeneral, normalizeBranding, normalizeSecurity } = require("../../src/services/platformConfigService");
const { sanitizeAuditFields } = require("../../src/services/platformAuditService");

function text(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function bool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(text(value, 20).toLowerCase());
}
async function leanRows(Model, filter = {}) {
  if (!Model) return [];
  const q = Model.find(filter);
  return typeof q.lean === "function" ? q.lean() : q;
}

function normalizedFieldwise({ current = {}, legacy = {}, defaults, fields, normalizer }) {
  const output = { ...defaults };
  for (const field of fields) {
    const legacyKey = field.legacyKey || field.key;
    const aliases = field.legacyAliases || [];
    const candidates = [];
    if (Object.prototype.hasOwnProperty.call(current || {}, field.key)) candidates.push(current[field.key]);
    if (Object.prototype.hasOwnProperty.call(legacy || {}, legacyKey)) candidates.push(legacy[legacyKey]);
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(legacy || {}, alias)) candidates.push(legacy[alias]);
    }
    candidates.push(defaults[field.key]);

    let accepted = false;
    for (const candidate of candidates) {
      try {
        const normalized = normalizer({ ...output, [field.key]: candidate });
        output[field.key] = normalized[field.key];
        accepted = true;
        break;
      } catch (_) {
        // Legacy/current values can be malformed. Fall through to the next
        // source and ultimately the safe built-in default.
      }
    }
    if (!accepted) throw new Error(`Unable to normalize platform config field ${field.key}.`);
  }
  return normalizer(output);
}

async function migratePlatformConfig(models) {
  const { PlatformConfig, PlatformSetting } = models;
  if (!PlatformConfig) return { created: 0, normalized: 0, duplicatesRemoved: 0, legacyImported: 0 };

  const legacyRows = PlatformSetting ? await leanRows(PlatformSetting, {}) : [];
  const legacy = Object.fromEntries(legacyRows.map((row) => [text(row.key, 120), row.value]));
  const legacyImported = Object.keys(legacy).length;

  const configs = await leanRows(PlatformConfig, {});
  let keeper = configs
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];

  const general = normalizedFieldwise({
    current: keeper?.general || {},
    legacy,
    defaults: DEFAULT_CONFIG.general,
    fields: [
      { key: "platformName", legacyKey: "platform_name" },
      { key: "baseDomain", legacyKey: "base_domain" },
      { key: "defaultTimezone", legacyKey: "default_timezone" },
      { key: "defaultCurrency", legacyKey: "default_currency" },
    ],
    normalizer: normalizeGeneral,
  });
  const branding = normalizedFieldwise({
    current: keeper?.branding || {},
    legacy,
    defaults: DEFAULT_CONFIG.branding,
    fields: [
      { key: "primaryColor", legacyKey: "brand_primary_color" },
      { key: "accentColor", legacyKey: "brand_accent_color" },
      { key: "supportEmail", legacyKey: "brand_support_email" },
    ],
    normalizer: normalizeBranding,
  });
  const security = normalizedFieldwise({
    current: keeper?.security || {},
    legacy,
    defaults: DEFAULT_CONFIG.security,
    fields: [
      { key: "passwordMinLength", legacyKey: "password_min_length" },
      { key: "sessionTimeoutMinutes", legacyKey: "session_timeout_minutes" },
      {
        key: "requireSuperadminEmail2fa",
        legacyKey: "require_superadmin_email_2fa",
        legacyAliases: ["allow_superadmin_2fa"],
      },
    ],
    normalizer: normalizeSecurity,
  });

  let created = 0;
  let normalized = 0;
  let duplicatesRemoved = 0;

  if (!keeper) {
    keeper = await PlatformConfig.create({ singletonKey: "platform", revision: 1, general, branding, security });
    created = 1;
  } else {
    const patch = {
      singletonKey: "platform",
      revision: Math.max(1, Number(keeper.revision || 1)),
      general,
      branding,
      security,
    };
    await PlatformConfig.updateOne({ _id: keeper._id }, { $set: patch });
    normalized = 1;
  }

  const keeperId = String(keeper._id || "");
  for (const row of configs) {
    if (String(row._id || "") === keeperId) continue;
    await PlatformConfig.deleteOne({ _id: row._id });
    duplicatesRemoved += 1;
  }

  return { created, normalized, duplicatesRemoved, legacyImported };
}

async function migratePlatformUsers(PlatformUser) {
  if (!PlatformUser) return { scanned: 0, normalized: 0 };
  const rows = await leanRows(PlatformUser, {});
  let normalized = 0;
  for (const row of rows) {
    const patch = {};
    if (!Number.isInteger(Number(row.revision)) || Number(row.revision) < 1) patch.revision = 1;
    if (!Number.isInteger(Number(row.tokenVersion)) || Number(row.tokenVersion) < 0) patch.tokenVersion = 0;
    if (Object.keys(patch).length) {
      await PlatformUser.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized };
}

async function migrateSupportTickets(SupportTicket) {
  if (!SupportTicket) return { scanned: 0, normalized: 0, historyBackfilled: 0 };
  const rows = await leanRows(SupportTicket, {});
  const statuses = new Set(["open", "pending", "resolved", "closed"]);
  let normalized = 0;
  let historyBackfilled = 0;
  for (const row of rows) {
    const status = statuses.has(text(row.status, 32).toLowerCase()) ? text(row.status, 32).toLowerCase() : "open";
    const revision = Math.max(1, Number(row.revision || 1));
    const patch = {};
    if (row.status !== status) patch.status = status;
    if (Number(row.revision || 0) !== revision) patch.revision = revision;
    if (!Array.isArray(row.statusHistory) || !row.statusHistory.length) {
      patch.statusHistory = [{
        at: row.createdAt || new Date(),
        fromStatus: "",
        toStatus: status,
        actorId: null,
        note: "Migration: initial lifecycle state.",
        revision,
      }];
      historyBackfilled += 1;
    }
    if (status === "resolved" && !row.resolvedAt) patch.resolvedAt = row.updatedAt || row.createdAt || new Date();
    if (status === "closed" && !row.closedAt) patch.closedAt = row.updatedAt || row.createdAt || new Date();
    if (Object.keys(patch).length) {
      await SupportTicket.updateOne({ _id: row._id }, { $set: patch });
      normalized += 1;
    }
  }
  return { scanned: rows.length, normalized, historyBackfilled };
}

async function migrateAuditLogs(AuditLog) {
  if (!AuditLog) return { scanned: 0, scrubbed: 0 };
  const rows = await leanRows(AuditLog, {});
  let scrubbed = 0;
  for (const row of rows) {
    const sanitized = sanitizeAuditFields({
      ipAddress: row.ipAddress || "",
      userAgent: row.userAgent || "",
      meta: row.meta || {},
    });
    const currentIp = text(row.ipAddress, 80);
    const currentUa = text(row.userAgent, 400);
    const currentMeta = JSON.stringify(row.meta || {});
    const nextMeta = JSON.stringify(sanitized.meta || {});
    const currentHash = text(row.ipHash, 128);
    const stableExistingHash = currentIp === sanitized.ipAddress && /^[a-f0-9]{64}$/i.test(currentHash);
    const nextHash = stableExistingHash ? currentHash : sanitized.ipHash;
    if (currentIp !== sanitized.ipAddress || currentUa !== sanitized.userAgent || currentMeta !== nextMeta || currentHash !== nextHash) {
      await AuditLog.updateOne(
        { _id: row._id },
        { $set: { ipAddress: sanitized.ipAddress, ipHash: nextHash, userAgent: sanitized.userAgent, meta: sanitized.meta } },
      );
      scrubbed += 1;
    }
  }
  return { scanned: rows.length, scrubbed };
}

async function migrateBookingClaims(PlatformBooking, now = new Date()) {
  if (!PlatformBooking) return { expiredClaimsReleased: 0, normalized: 0 };
  const result = await PlatformBooking.updateMany(
    {
      status: "claimed",
      blocksSlot: true,
      claimExpiresAt: { $lte: now },
      calendarEventId: { $in: [null, ""] },
    },
    {
      $set: { status: "failed", blocksSlot: false, claimExpiresAt: null, failureReason: "Migration: expired booking claim released." },
      $inc: { revision: 1 },
    },
  );
  const expiredClaimsReleased = Number(result?.modifiedCount ?? result?.nModified ?? 0);
  const normalizeResult = await PlatformBooking.updateMany(
    { $or: [{ revision: { $exists: false } }, { revision: { $lt: 1 } }] },
    { $set: { revision: 1 } },
  );
  return { expiredClaimsReleased, normalized: Number(normalizeResult?.modifiedCount ?? normalizeResult?.nModified ?? 0) };
}

async function migratePlatformOperations(models, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const config = await migratePlatformConfig(models);
  const users = await migratePlatformUsers(models.PlatformUser);
  const support = await migrateSupportTickets(models.SupportTicket);
  const audit = await migrateAuditLogs(models.AuditLog);
  const bookings = await migrateBookingClaims(models.PlatformBooking, now);
  return { config, users, support, audit, bookings };
}

module.exports = {
  migratePlatformOperations,
  migratePlatformConfig,
  normalizedFieldwise,
  migratePlatformUsers,
  migrateSupportTickets,
  migrateAuditLogs,
  migrateBookingClaims,
};
