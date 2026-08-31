const crypto = require("crypto");
function inviteSecret() {
  const secret = String(process.env.INVITE_TOKEN_SECRET || "");
  if (!secret || secret.length < 32) throw new Error("INVITE_TOKEN_SECRET must be at least 32 characters.");
  return secret;
}
function hashRawToken(rawToken) {
  return crypto.createHmac("sha256", inviteSecret()).update(String(rawToken)).digest("hex");
}
module.exports = { hashRawToken, inviteSecret };
