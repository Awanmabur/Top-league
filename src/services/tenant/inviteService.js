const crypto = require("crypto");
const mongoose = require("mongoose");
const { sendMail } = require("../utils/mailer");

function inviteSecret() {
  const secret = process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret)
    throw new Error("Missing INVITE_TOKEN_SECRET (or JWT_SECRET fallback)");
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

function buildInviteLink(req, rawToken) {
  const proto = getProto(req);
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}/set-password?token=${encodeURIComponent(rawToken)}`;
}

function emailHtml({ name, inviteLink, tenantName }) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>${tenantName || "Classic Campus"} – Set your password</h2>
    <p>Hello ${name || ""},</p>
    <p>Your account has been created. Click the button below to set your password:</p>
    <p>
      <a href="${inviteLink}" style="display:inline-block;padding:12px 16px;background:#0b5cff;color:#fff;text-decoration:none;border-radius:8px">
        Set Password
      </a>
    </p>
    <p>This link expires in 24 hours. If it expires, request a new link.</p>
    <p style="color:#666;font-size:12px">If you didn’t request this, ignore this email.</p>
  </div>`;
}

/**
 * Create + store invite token (revokes old unused ones), returns { inviteLink, rawToken }
 */
async function createInvite({ req, userId, createdBy = null }) {
  const { InviteToken } = req.models || {};
  if (!InviteToken) throw new Error("InviteToken model not loaded");

  if (!mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new Error("Invalid userId for invite");
  }

  await InviteToken.updateMany(
    { userId, purpose: "set_password", usedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  const rawToken = makeInviteToken();
  const tokenHash = hmacToken(rawToken);

  await InviteToken.create({
    userId,
    tokenHash,
    purpose: "set_password",
    expiresAt: nowPlusHours(24),
    usedAt: null,
    revokedAt: null,
    createdBy: createdBy || req.user?.userId || req.user?._id || null,
    createdIp: req.ip,
    createdUa: req.get("user-agent") || null,
  });

  const inviteLink = buildInviteLink(req, rawToken);
  return { rawToken, inviteLink };
}

/**
 * Create invite + email it
 */
async function sendPasswordInviteEmail({ req, toEmail, toName, userId }) {
  if (!toEmail) return { ok: false, skipped: true, reason: "missing_email" };

  const { inviteLink } = await createInvite({ req, userId });

  const tenantName =
    req.tenant?.name ||
    req.tenant?.title ||
    req.tenant?.code ||
    "Classic Campus";

  await sendMail({
    to: toEmail,
    subject: `${tenantName}: Set your password`,
    html: emailHtml({ name: toName, inviteLink, tenantName }),
  });

  return { ok: true, inviteLink };
}

module.exports = {
  createInvite,
  sendPasswordInviteEmail,
};
