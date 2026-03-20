const bcrypt = require("bcrypt");
const { hashRawToken } = require("../../../utils/inviteToken");

function isStrongPassword(pw) {
  return (
    typeof pw === "string" &&
    pw.length >= 8 &&
    /[a-z]/.test(pw) &&
    /[A-Z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

module.exports = {
  /**
   * GET /set-password?token=RAW
   */
  async setPasswordForm(req, res) {
    try {
      const { InviteToken, User } = req.models || {};
      if (!InviteToken || !User) return res.status(500).send("Models not loaded");

      const rawToken = String(req.query.token || "").trim();
      if (!rawToken) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Missing token",
          token: "",
          email: "",
        });
      }

      // ✅ hash INSIDE handler
      const tokenHash = hashRawToken(rawToken);

      const record = await InviteToken.findOne({
        tokenHash,
        purpose: "set_password",
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean();

      if (!record) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "This link is invalid or expired. Ask admin to resend an invite.",
          token: "",
          email: "",
        });
      }

      const user = await User.findOne({ _id: record.userId, deletedAt: null })
        .select("_id email")
        .lean();

      if (!user) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "User not found for this invite.",
          token: "",
          email: "",
        });
      }

      return res.render("tenant/auth/set-password", {
        error: null,
        token: rawToken, // raw token only lives in the page hidden input
        email: user.email,
      });
    } catch (err) {
      console.error("SET PASSWORD FORM ERROR:", err);
      return res.status(500).send("Server error");
    }
  },

  /**
   * POST /set-password
   */
  async setPasswordSubmit(req, res) {
    try {
      const { InviteToken, User } = req.models || {};
      if (!InviteToken || !User) return res.status(500).send("Models not loaded");

      const rawToken = String(req.body.token || "").trim();
      const password = String(req.body.password || "");
      const confirmPassword = String(req.body.confirmPassword || "");

      if (!rawToken) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Missing token.",
          token: "",
          email: "",
        });
      }

      const tokenHash = hashRawToken(rawToken);

      const record = await InviteToken.findOne({
        tokenHash,
        purpose: "set_password",
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });

      if (!record) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "This link is invalid or expired. Ask admin to resend an invite.",
          token: "",
          email: "",
        });
      }

      const user = await User.findOne({ _id: record.userId, deletedAt: null });
      if (!user) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "User not found for this invite.",
          token: "",
          email: "",
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Passwords do not match.",
          token: rawToken,
          email: user.email,
        });
      }

      if (!isStrongPassword(password)) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Password must be 8+ and include uppercase, lowercase, number, and symbol.",
          token: rawToken,
          email: user.email,
        });
      }

      // ✅ Save password + activate + invalidate old JWTs
      user.passwordHash = await bcrypt.hash(password, 12);
      user.status = "active";
      user.tokenVersion = Number(user.tokenVersion || 0) + 1;
      await user.save();

      // ✅ Mark THIS token used
      record.usedAt = new Date();
      await record.save();

      // ✅ Revoke any other active invites (optional)
      await InviteToken.updateMany(
        {
          userId: user._id,
          purpose: "set_password",
          usedAt: null,
          revokedAt: null,
          _id: { $ne: record._id },
        },
        { $set: { revokedAt: new Date() } }
      );

      return res.redirect("/login");
    } catch (err) {
      console.error("SET PASSWORD SUBMIT ERROR:", err);
      return res.status(500).send("Server error");
    }
  },
};
