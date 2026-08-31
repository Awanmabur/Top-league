const bcrypt = require("bcrypt");
const { hashRawToken } = require("../../../utils/inviteToken");
const { validatePasswordStrength } = require("../../../utils/passwordPolicy");

function renderSetPassword(res, locals = {}, statusCode = 200) {
  return res.status(statusCode).render("tenant/auth/set-password", { error: null, token: "", email: "", csrfToken: "", ...locals });
}
async function releaseClaim(InviteToken, id, usedAt) {
  await InviteToken.updateOne({ _id: id, usedAt, revokedAt: null }, { $set: { usedAt: null } }).catch(() => {});
}

module.exports = {
  async setPasswordForm(req, res) {
    try {
      const { InviteToken, User } = req.models || {};
      if (!InviteToken || !User) return res.status(500).send("Models not loaded");
      const rawToken = String(req.query.token || "").trim();
      if (!rawToken) return renderSetPassword(res, { error: "Missing token.", csrfToken: res.locals.csrfToken || "" }, 400);
      const record = await InviteToken.findOne({ tokenHash: hashRawToken(rawToken), purpose: "set_password", usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
      if (!record) return renderSetPassword(res, { error: "This link is invalid or expired. Ask admin to resend an invite.", csrfToken: res.locals.csrfToken || "" }, 400);
      const user = await User.findOne({ _id: record.userId, deletedAt: null }).select("_id email +passwordHash status").lean();
      if (!user) return renderSetPassword(res, { error: "User not found for this invite.", csrfToken: res.locals.csrfToken || "" }, 400);
      if (user.passwordHash) return renderSetPassword(res, { error: "A password is already set for this account. Use the password-reset workflow instead.", csrfToken: res.locals.csrfToken || "" }, 400);
      return renderSetPassword(res, { token: rawToken, email: user.email, csrfToken: res.locals.csrfToken || "" });
    } catch (err) { console.error("SET PASSWORD FORM ERROR:", err); return res.status(500).send("Server error"); }
  },

  async setPasswordSubmit(req, res) {
    try {
      const { InviteToken, User } = req.models || {};
      if (!InviteToken || !User) return res.status(500).send("Models not loaded");
      const rawToken = String(req.body.token || "").trim(), password = String(req.body.password || ""), confirmPassword = String(req.body.confirmPassword || "");
      if (!rawToken) return renderSetPassword(res, { error: "Missing token.", csrfToken: res.locals.csrfToken || "" }, 400);
      const tokenHash = hashRawToken(rawToken), now = new Date();
      const record = await InviteToken.findOne({ tokenHash, purpose: "set_password", usedAt: null, revokedAt: null, expiresAt: { $gt: now } }).lean();
      if (!record) return renderSetPassword(res, { error: "This link is invalid or expired. Ask admin to resend an invite.", csrfToken: res.locals.csrfToken || "" }, 400);
      const user = await User.findOne({ _id: record.userId, deletedAt: null }).select("_id email status tokenVersion updatedAt +passwordHash").lean();
      if (!user) return renderSetPassword(res, { error: "User not found for this invite.", csrfToken: res.locals.csrfToken || "" }, 400);
      if (user.passwordHash) return renderSetPassword(res, { error: "A password is already set for this account. Use the password-reset workflow instead.", email: user.email, csrfToken: res.locals.csrfToken || "" }, 400);
      if (password !== confirmPassword) return renderSetPassword(res, { error: "Passwords do not match.", token: rawToken, email: user.email, csrfToken: res.locals.csrfToken || "" }, 400);
      const passwordError = validatePasswordStrength(password, { minLength: 10 });
      if (passwordError) return renderSetPassword(res, { error: passwordError, token: rawToken, email: user.email, csrfToken: res.locals.csrfToken || "" }, 400);

      // Hash before claiming so CPU/password-policy failures never consume a one-time token.
      const newHash = await bcrypt.hash(password, 12);
      const claimed = await InviteToken.findOneAndUpdate({ _id: record._id, usedAt: null, revokedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { new: true });
      if (!claimed) return renderSetPassword(res, { error: "This link has already been used. Ask admin to resend an invite.", email: user.email, csrfToken: res.locals.csrfToken || "" }, 400);

      const previousStatus = user.status || "invited", previousVersion = Number(user.tokenVersion || 0);
      let userChanged = false;
      try {
        const changed = await User.updateOne(
          { _id: user._id, deletedAt: null, $or: [{ passwordHash: null }, { passwordHash: "" }, { passwordHash: { $exists: false } }], updatedAt: user.updatedAt },
          { $set: { passwordHash: newHash, status: "active" }, $inc: { tokenVersion: 1 } },
        );
        if (Number(changed.modifiedCount || 0) !== 1) throw new Error("Account changed while the invitation was being accepted.");
        userChanged = true;
        await InviteToken.updateMany({ userId: user._id, purpose: "set_password", usedAt: null, revokedAt: null, _id: { $ne: claimed._id } }, { $set: { revokedAt: now } });
      } catch (err) {
        if (userChanged) {
          await User.updateOne({ _id: user._id, passwordHash: newHash, status: "active", tokenVersion: previousVersion + 1 }, { $set: { passwordHash: null, status: previousStatus, tokenVersion: previousVersion } }).catch(() => {});
        }
        await releaseClaim(InviteToken, claimed._id, now);
        throw err;
      }
      return res.redirect("/login");
    } catch (err) { console.error("SET PASSWORD SUBMIT ERROR:", err); return res.status(500).send("Server error"); }
  },
};
