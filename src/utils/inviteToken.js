const crypto = require("crypto");

// ✅ One standard function name
function hashRawToken(rawToken) {
  const secret = process.env.INVITE_TOKEN_SECRET;
  if (!secret) throw new Error("Missing INVITE_TOKEN_SECRET");

  return crypto
    .createHmac("sha256", secret)
    .update(String(rawToken))
    .digest("hex");
}

module.exports = { hashRawToken };
