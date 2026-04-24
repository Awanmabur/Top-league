const bcrypt = require("bcrypt");
const { hashRawToken } = require("../../../utils/inviteToken");
const { validatePasswordStrength } = require("../../../utils/passwordPolicy");

function renderSetPassword(res, locals = {}, statusCode = 200) {
  return res.status(statusCode).render("tenant/auth/set-password", {
    error: null,
    token: "",
    email: "",
    csrfToken: "",
    ...locals,
  });
}

module.exports = {
  async setPasswordForm(req, res) {
    try {
      const { InviteToken, User } = req.models || {};
      if (!InviteToken || !User) return res.status(500).send("Models not loaded");

      const rawToken = String(req.query.token || "").trim();
      if (!rawToken) {
        return renderSetPassword(
          res,
          {
            error: "Missing token.",
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      const tokenHash = hashRawToken(rawToken);

      const record = await InviteToken.findOne({
        tokenHash,
        purpose: "set_password",
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean();

      if (!record) {
        return renderSetPassword(
          res,
          {
            error: "This link is invalid or expired. Ask admin to resend an invite.",
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      const user = await User.findOne({ _id: record.userId, deletedAt: null })
        .select("_id email")
        .lean();

      if (!user) {
        return renderSetPassword(
          res,
          {
            error: "User not found for this invite.",
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      return renderSetPassword(res, {
        token: rawToken,
        email: user.email,
        csrfToken: res.locals.csrfToken || "",
      });
    } catch (err) {
      console.error("SET PASSWORD FORM ERROR:", err);
      return res.status(500).send("Server error");
    }
  },

  async setPasswordSubmit(req, res) {
    try {
      const { InviteToken, User } = req.models || {};
      if (!InviteToken || !User) return res.status(500).send("Models not loaded");

      const rawToken = String(req.body.token || "").trim();
      const password = String(req.body.password || "");
      const confirmPassword = String(req.body.confirmPassword || "");

      if (!rawToken) {
        return renderSetPassword(
          res,
          {
            error: "Missing token.",
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      const tokenHash = hashRawToken(rawToken);
      const now = new Date();

      const record = await InviteToken.findOne({
        tokenHash,
        purpose: "set_password",
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: now },
      }).lean();

      if (!record) {
        return renderSetPassword(
          res,
          {
            error: "This link is invalid or expired. Ask admin to resend an invite.",
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      const user = await User.findOne({ _id: record.userId, deletedAt: null });
      if (!user) {
        return renderSetPassword(
          res,
          {
            error: "User not found for this invite.",
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      if (password !== confirmPassword) {
        return renderSetPassword(
          res,
          {
            error: "Passwords do not match.",
            token: rawToken,
            email: user.email,
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      const passwordError = validatePasswordStrength(password, { minLength: 10 });
      if (passwordError) {
        return renderSetPassword(
          res,
          {
            error: passwordError,
            token: rawToken,
            email: user.email,
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      const claimedInvite = await InviteToken.findOneAndUpdate(
        {
          _id: record._id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
        { new: true },
      );

      if (!claimedInvite) {
        return renderSetPassword(
          res,
          {
            error: "This link has already been used. Ask admin to resend an invite.",
            email: user.email,
            csrfToken: res.locals.csrfToken || "",
          },
          400,
        );
      }

      user.passwordHash = await bcrypt.hash(password, 12);
      user.status = "active";
      user.tokenVersion = Number(user.tokenVersion || 0) + 1;
      await user.save();

      await InviteToken.updateMany(
        {
          userId: user._id,
          purpose: "set_password",
          usedAt: null,
          revokedAt: null,
          _id: { $ne: claimedInvite._id },
        },
        { $set: { revokedAt: now } },
      );

      return res.redirect("/login");
    } catch (err) {
      console.error("SET PASSWORD SUBMIT ERROR:", err);
      return res.status(500).send("Server error");
    }
  },
};
