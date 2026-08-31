const crypto = require("crypto");
const { hashRawToken } = require("./inviteToken");

function makeInviteToken() { return crypto.randomBytes(32).toString("base64url"); }
function nowPlusHours(h) { return new Date(Date.now() + h * 60 * 60 * 1000); }
function getProto(req) { return (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0].trim(); }
function buildInviteLink({ req, rawToken, baseUrl = null }) {
  const finalBaseUrl = baseUrl ? String(baseUrl).replace(/\/+$/, "") : `${getProto(req)}://${req.get("x-forwarded-host") || req.get("host")}`;
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
module.exports = { createSetPasswordInvite, buildInviteLink };
