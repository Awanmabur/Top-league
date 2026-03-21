const crypto = require("crypto");

/**
 * We store ONLY tokenHash (HMAC). Raw token is only sent by email.
 * Requires: INVITE_TOKEN_SECRET (or JWT_SECRET fallback)
 */

function inviteSecret() {
  const secret = process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing INVITE_TOKEN_SECRET (or JWT_SECRET fallback)");
  }
  return secret;
}

function makeInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hmacToken(rawToken) {
  return crypto
    .createHmac("sha256", inviteSecret())
    .update(String(rawToken))
    .digest("hex");
}

function nowPlusHours(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function getProto(req) {
  return (req.get("x-forwarded-proto") || req.protocol || "http")
    .split(",")[0]
    .trim();
}

function buildInviteLink({ req, rawToken, baseUrl = null }) {
  const finalBaseUrl = baseUrl
    ? String(baseUrl).replace(/\/+$/, "")
    : `${getProto(req)}://${req.get("x-forwarded-host") || req.get("host")}`;

  return `${finalBaseUrl}/set-password?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Create set-password invite token for a user (revokes old unused tokens).
 * @param {Object} params
 * @param {Object} params.req - express req
 * @param {Model}  params.InviteToken - tenant InviteToken model
 * @param {String|ObjectId} params.userId
 * @param {String|ObjectId|null} params.createdBy
 * @param {String|null} params.baseUrl - optional override, e.g. https://tenant.example.com
 * @returns {Promise<{inviteLink: string, rawToken: string, expiresAt: Date}>}
 */
async function createSetPasswordInvite({
  req,
  InviteToken,
  userId,
  createdBy = null,
  baseUrl = null,
}) {
  if (!InviteToken) throw new Error("InviteToken model missing");
  if (!userId) throw new Error("userId is required");

  await InviteToken.updateMany(
    { userId, purpose: "set_password", usedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  const rawToken = makeInviteToken();
  const tokenHash = hmacToken(rawToken);
  const expiresAt = nowPlusHours(24);

  await InviteToken.create({
    userId,
    tokenHash,
    purpose: "set_password",
    expiresAt,
    usedAt: null,
    revokedAt: null,
    createdBy: createdBy || req.user?.userId || req.user?._id || null,
    createdIp: req.ip,
    createdUa: req.get("user-agent") || null,
  });

  return {
    rawToken,
    inviteLink: buildInviteLink({ req, rawToken, baseUrl }),
    expiresAt,
  };
}

module.exports = {
  createSetPasswordInvite,
};