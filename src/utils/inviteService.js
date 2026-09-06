const crypto = require("crypto");
const { hashRawToken } = require("./inviteToken");

function makeInviteToken() { return crypto.randomBytes(32).toString("base64url"); }
function nowPlusHours(h) { return new Date(Date.now() + h * 60 * 60 * 1000); }

function safeHostname(value) {
  const host = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || host.includes(":") || host.includes("/") || host.includes("\\")) return "";
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return host;
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".") || host.includes("..")) return "";
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return "";
  return host;
}

function normalizeExplicitBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("Invite base URL is invalid."); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Invite base URL is invalid.");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("Production invite links require HTTPS.");
  if (!safeHostname(parsed.hostname)) throw new Error("Invite base URL host is invalid.");
  return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
}

function canonicalTenantBaseUrl(req) {
  const tenant = req?.tenant || {};
  const baseDomain = safeHostname(process.env.BASE_DOMAIN || "");
  let host = safeHostname(tenant.customDomain || "");
  if (!host) {
    const subdomain = String(tenant.subdomain || tenant.code || "").trim().toLowerCase();
    host = safeHostname(subdomain);
    if (!host && baseDomain && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      host = safeHostname(`${subdomain}.${baseDomain}`);
    }
  }
  if (!host && process.env.NODE_ENV !== "production") {
    host = safeHostname(req?.hostname || "localhost") || "localhost";
    const localPort = Number(req?.socket?.localPort || process.env.PORT || 0);
    const port = localPort > 0 && localPort <= 65535 ? `:${localPort}` : "";
    const proto = req?.protocol === "https" ? "https" : "http";
    return `${proto}://${host}${port}`;
  }
  if (!host) throw new Error("Canonical tenant hostname is not configured for invite links.");
  return `https://${host}`;
}

function buildInviteLink({ req, rawToken, baseUrl = null }) {
  const finalBaseUrl = baseUrl ? normalizeExplicitBaseUrl(baseUrl) : canonicalTenantBaseUrl(req);
  return `${finalBaseUrl}/set-password?token=${encodeURIComponent(rawToken)}`;
}

async function createSetPasswordInvite({ req, InviteToken, userId, createdBy = null, baseUrl = null, session = null }) {
  if (!InviteToken) throw new Error("InviteToken model missing");
  if (!userId) throw new Error("userId is required");
  const opts = session ? { session } : undefined;
  const now = new Date();
  await InviteToken.updateMany(
    { userId, purpose: "set_password", usedAt: null, revokedAt: null },
    { $set: { revokedAt: now } },
    opts,
  );
  const rawToken = makeInviteToken();
  const tokenHash = hashRawToken(rawToken);
  const expiresAt = nowPlusHours(24);
  const doc = {
    userId,
    tokenHash,
    hashVersion: 1,
    purpose: "set_password",
    expiresAt,
    usedAt: null,
    revokedAt: null,
    createdBy: createdBy || req.user?.userId || req.user?._id || null,
    createdIp: String(req.ip || "").slice(0, 128) || null,
    createdUa: String(req.get("user-agent") || "").slice(0, 600) || null,
  };
  if (session) await InviteToken.create([doc], { session });
  else await InviteToken.create(doc);
  return { rawToken, inviteLink: buildInviteLink({ req, rawToken, baseUrl }), expiresAt };
}

module.exports = { createSetPasswordInvite, buildInviteLink, canonicalTenantBaseUrl, normalizeExplicitBaseUrl };
