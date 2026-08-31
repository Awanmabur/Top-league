const { inferCategory, CATEGORY_FIELDS } = require("../../src/services/tenant/notificationService");
const { encryptCredential, buildProbeUrl } = require("../../src/services/tenant/integrationService");

function str(v) { return String(v ?? "").trim(); }
function parseMs(v) { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; }
function cleanMethod(v) { return String(v || "").toUpperCase() === "GET" ? "GET" : "HEAD"; }
function cleanStatus(v) { return String(v || "").toLowerCase().startsWith("succ") ? "Success" : "Failed"; }
function validCategory(v) { return CATEGORY_FIELDS.includes(str(v).toLowerCase()); }
function safeSetBoolean(row, key, fallback = true) { return typeof row?.[key] === "boolean" ? row[key] : fallback; }
function normalizeIntegrationUrl(row) {
  try {
    const target = buildProbeUrl(row.baseUrl, row.endpoint || "/");
    return { baseUrl: new URL(row.baseUrl).origin + (new URL(row.baseUrl).pathname === "/" ? "" : new URL(row.baseUrl).pathname.replace(/\/$/, "")), endpoint: `${target.pathname}${target.search}` || "/", error: "" };
  } catch (err) { return { baseUrl: str(row.baseUrl), endpoint: str(row.endpoint) || "/", error: String(err?.message || "Invalid integration URL").slice(0, 500) }; }
}

async function migrateIdentityIntegrations(models, options = {}) {
  const InviteToken = models?.InviteToken, Notification = models?.Notification, NotificationPreference = models?.NotificationPreference, ApiIntegration = models?.ApiIntegration;
  const now = options.now || new Date();
  const stats = { inviteTokensRevoked: 0, notificationsNormalized: 0, preferencesNormalized: 0, integrationsNormalized: 0, integrationsQuarantined: 0, plaintextCredentialsEncrypted: 0, duplicateIntegrationsQuarantined: 0 };

  if (InviteToken?.collection) {
    const result = await InviteToken.collection.updateMany(
      { usedAt: null, revokedAt: null, $or: [{ hashVersion: { $exists: false } }, { hashVersion: { $ne: 1 } }] },
      { $set: { revokedAt: now } },
    );
    stats.inviteTokensRevoked = Number(result.modifiedCount || 0);
  }

  if (Notification?.collection) {
    const rows = await Notification.collection.find({ isDeleted: { $ne: true } }).toArray();
    for (const row of rows) {
      const category = validCategory(row.category) ? str(row.category).toLowerCase() : inferCategory(row);
      const set = { category };
      if (row.audience === "admin" && !row.userId && row.isRead === true && !row.adminReviewedAt) {
        set.adminReviewedAt = row.readAt || row.updatedAt || row.createdAt || now;
      }
      await Notification.collection.updateOne({ _id: row._id }, { $set: set });
      stats.notificationsNormalized += 1;
    }
  }

  if (NotificationPreference?.collection) {
    const rows = await NotificationPreference.collection.find({}).toArray();
    for (const row of rows) {
      const set = { inApp: safeSetBoolean(row, "inApp", true), isDeleted: row.isDeleted === true };
      for (const key of CATEGORY_FIELDS) set[key] = key === "system" ? true : safeSetBoolean(row, key, true);
      await NotificationPreference.collection.updateOne({ _id: row._id }, { $set: set });
      stats.preferencesNormalized += 1;
    }
  }

  if (ApiIntegration?.collection) {
    const rows = await ApiIntegration.collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
    const seenActiveNames = new Set();
    for (const row of rows) {
      const unset = {};
      const set = {
        revision: Math.max(0, Number(row.revision || 0)),
        endpoint: str(row.endpoint) || "/",
        testMethod: cleanMethod(row.testMethod || "HEAD"),
        lastTestStatus: ["Success", "Failed", "Never"].includes(row.lastTestStatus) ? row.lastTestStatus : (row.lastTestAt ? "Failed" : "Never"),
        lastStatusCode: Math.max(0, Number(row.lastStatusCode || 0)),
        migrationQuarantinedAt: row.migrationQuarantinedAt || null,
        migrationQuarantineReason: str(row.migrationQuarantineReason).slice(0, 500),
      };
      set.status = ["Active", "Disabled", "Error"].includes(row.status) ? row.status : "Disabled";
      set.authType = ["API Key", "Bearer Token", "Basic Auth", "OAuth2", "None"].includes(row.authType) ? row.authType : "None";
      const normalizedUrl = normalizeIntegrationUrl({ ...row, endpoint: set.endpoint });
      set.baseUrl = normalizedUrl.baseUrl;
      set.endpoint = normalizedUrl.endpoint;
      let quarantineReason = normalizedUrl.error;

      const plaintext = str(row.apiKey);
      if (set.authType === "None") {
        Object.assign(set, { credentialCiphertext: "", credentialIv: "", credentialTag: "", credentialVersion: 1 });
        unset.apiKey = "";
      } else if (plaintext) {
        Object.assign(set, encryptCredential(plaintext));
        unset.apiKey = "";
        stats.plaintextCredentialsEncrypted += 1;
      } else if (!row.credentialCiphertext && set.status === "Active") {
        quarantineReason ||= "Active legacy integration is missing its required credential.";
      }

      const logs = Array.isArray(row.requestLogs) ? row.requestLogs.slice(-100).map((log) => ({
        endpoint: str(log.endpoint || set.endpoint).slice(0, 500), method: cleanMethod(log.method), status: cleanStatus(log.status), statusCode: Math.max(0, Math.min(599, Number(log.statusCode || 0))), responseTimeMs: parseMs(log.responseTimeMs ?? log.responseTime), message: str(log.message).slice(0, 220), createdAt: log.createdAt || row.updatedAt || row.createdAt || now,
      })) : [];
      set.requestLogs = logs;
      const oldMetrics = row.metrics || {};
      set.metrics = { requests: Math.max(0, Number(oldMetrics.requests || logs.length || 0)), success: Math.max(0, Number(oldMetrics.success || logs.filter((x) => x.status === "Success").length)), failures: Math.max(0, Number(oldMetrics.failures || logs.filter((x) => x.status === "Failed").length)), avgResponseMs: parseMs(oldMetrics.avgResponseMs ?? oldMetrics.avgResponse) };

      const nameKey = str(row.name);
      if (row.isDeleted !== true && nameKey && !quarantineReason) {
        if (seenActiveNames.has(nameKey)) { quarantineReason = "Duplicate active integration name quarantined before unique index synchronization."; stats.duplicateIntegrationsQuarantined += 1; }
        else seenActiveNames.add(nameKey);
      }
      if (quarantineReason) {
        set.status = "Disabled";
        set.migrationQuarantinedAt = row.migrationQuarantinedAt || now;
        set.migrationQuarantineReason = quarantineReason.slice(0, 500);
        stats.integrationsQuarantined += 1;
      }
      const update = { $set: set };
      if (Object.keys(unset).length) update.$unset = unset;
      await ApiIntegration.collection.updateOne({ _id: row._id }, update);
      stats.integrationsNormalized += 1;
    }
  }
  return stats;
}
module.exports = { migrateIdentityIntegrations };
