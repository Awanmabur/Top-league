const { privacyHmac } = require("../../src/services/tenant/publicPresenceService");
const VALID_STATUSES = new Set(["new", "read", "resolved"]);

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

async function migrateInquiries(models, options = {}) {
  const SchoolInquiry = models?.SchoolInquiry;
  if (!SchoolInquiry) return { scanned: 0, normalized: 0, schoolCodesBackfilled: 0, privacyScrubbed: 0 };

  const schoolCode = clean(options.schoolCode, 80).toLowerCase();
  const rows = await SchoolInquiry.find({}).select("status schoolCode createdAt updatedAt readAt resolvedAt isDeleted ipHash userAgent userAgentHash");
  let normalized = 0;
  let schoolCodesBackfilled = 0;
  let privacyScrubbed = 0;

  for (const row of rows) {
    const rawStatus = clean(row.status, 32).toLowerCase();
    const status = VALID_STATUSES.has(rawStatus) ? rawStatus : "new";
    let changed = false;

    if (row.status !== status) {
      row.status = status;
      changed = true;
      normalized += 1;
    }
    if (!clean(row.schoolCode, 80) && schoolCode) {
      row.schoolCode = schoolCode;
      changed = true;
      schoolCodesBackfilled += 1;
    }
    if (status === "read" && !row.readAt) {
      row.readAt = row.updatedAt || row.createdAt || new Date();
      changed = true;
    }
    if (status === "resolved" && !row.resolvedAt) {
      row.resolvedAt = row.updatedAt || row.createdAt || new Date();
      changed = true;
    }
    if (typeof row.isDeleted !== "boolean") {
      row.isDeleted = false;
      changed = true;
    }
    if (!clean(row.userAgentHash, 128)) {
      const ua = clean(row.userAgent, 200);
      row.userAgentHash = privacyHmac("inquiry-user-agent", ua);
      row.userAgent = "";
      row.ipHash = "";
      changed = true;
      privacyScrubbed += 1;
    } else if (clean(row.userAgent, 200)) {
      row.userAgent = "";
      changed = true;
      privacyScrubbed += 1;
    }
    if (changed) await row.save();
  }

  return { scanned: rows.length, normalized, schoolCodesBackfilled, privacyScrubbed };
}

module.exports = { migrateInquiries };
