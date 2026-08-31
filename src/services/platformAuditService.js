const crypto = require("crypto");

const SECRET_KEY_RX = /(pass(word)?|secret|token|cookie|authorization|api[-_]?key|credential|private[-_]?key|session|refresh|access[-_]?key)/i;

function auditSecret() {
  const value = String(
    process.env.PLATFORM_AUDIT_PRIVACY_SECRET ||
      process.env.SESSION_SECRET ||
      process.env.DATA_ENCRYPTION_KEY ||
      "",
  );
  if (process.env.NODE_ENV === "production" && value.length < 16) {
    throw new Error("PLATFORM_AUDIT_PRIVACY_SECRET (or SESSION_SECRET/DATA_ENCRYPTION_KEY) is required for platform audit privacy.");
  }
  return value || "classic-academy-platform-audit-dev-only";
}

function privacyHmac(label, value) {
  return crypto.createHmac("sha256", auditSecret()).update(`${label}\0${String(value || "")}`).digest("hex");
}

function maskIp(value) {
  const ip = String(value || "").trim();
  if (!ip) return "";
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0`;
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean).slice(0, 4);
    return parts.length ? `${parts.join(":")}::` : "::";
  }
  return "masked";
}

function boundedString(value, max = 1000) {
  return String(value == null ? "" : value).slice(0, max);
}

function redactAuditValue(value, depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return boundedString(value, 2000);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditValue(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      output[key] = SECRET_KEY_RX.test(key) ? "[REDACTED]" : redactAuditValue(item, depth + 1);
    }
    return output;
  }
  return boundedString(value, 500);
}

function sanitizeAuditFields({ ipAddress = "", userAgent = "", meta = {} } = {}) {
  const rawIp = String(ipAddress || "").trim();
  const ua = boundedString(userAgent, 400);
  return {
    ipAddress: maskIp(rawIp),
    ipHash: rawIp ? privacyHmac("platform-audit-ip", rawIp) : "",
    userAgent: ua,
    meta: redactAuditValue(meta),
  };
}

module.exports = {
  SECRET_KEY_RX,
  auditSecret,
  privacyHmac,
  maskIp,
  redactAuditValue,
  sanitizeAuditFields,
};
