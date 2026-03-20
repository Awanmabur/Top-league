const bcrypt = require("bcrypt");
const { hashRawToken } = require("../../../utils/inviteToken");

function isStrongPassword(p) {
  return (
    typeof p === "string" &&
    p.length >= 10 &&
    /[A-Z]/.test(p) &&
    /[a-z]/.test(p) &&
    /[0-9]/.test(p) &&
    /[^A-Za-z0-9]/.test(p)
  );
}

module.exports = {
  // GET /set-password?token=RAW
  async page(req, res) {
    try {
      const { User, InviteToken } = req.models || {};
      if (!User || !InviteToken)
        return res.status(500).send("Models not loaded");

      // avoid buffering timeouts
      if (req.tenantConnection && req.tenantConnection.readyState !== 1) {
        return res.status(503).send("Tenant DB not ready. Retry.");
      }

      const rawToken = String(req.query.token || "").trim();
      if (!rawToken) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Missing token",
          token: "",
          email: "",
        });
      }

      const tokenHash = hashRawToken(rawToken);

      const invite = await InviteToken.findOne({
        tokenHash,
        purpose: "set_password",
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean();

      if (!invite) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Invalid or expired link. Ask admin to resend an invite.",
          token: "",
          email: "",
        });
      }

      const user = await User.findOne({ _id: invite.userId, deletedAt: null })
        .select("email")
        .lean();

      return res.render("tenant/auth/set-password", {
        error: null,
        token: rawToken,
        email: user?.email || "",
      });
    } catch (err) {
      console.error("SET PASSWORD PAGE ERROR:", err);
      return res.status(500).send("Server error");
    }
  },

  // POST /set-password
  async submit(req, res) {
    const { User, InviteToken } = req.models || {};
    const rawToken = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    try {
      if (!User || !InviteToken)
        return res.status(500).send("Models not loaded");

      if (req.tenantConnection && req.tenantConnection.readyState !== 1) {
        return res.status(503).render("tenant/auth/set-password", {
          error: "Tenant DB not ready. Retry.",
          token: rawToken || "",
          email: "",
        });
      }

      if (!rawToken) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Missing token",
          token: "",
          email: "",
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Passwords do not match",
          token: rawToken,
          email: "",
        });
      }

      if (!isStrongPassword(password)) {
        return res.status(400).render("tenant/auth/set-password", {
          error:
            "Password must be 10+ chars with upper, lower, number, and symbol.",
          token: rawToken,
          email: "",
        });
      }

      const tokenHash = hashRawToken(rawToken);
      const now = new Date();

      // ✅ Atomic: mark invite used ONLY if still valid
      const invite = await InviteToken.findOneAndUpdate(
        {
          tokenHash,
          purpose: "set_password",
          usedAt: null,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
        { new: true },
      );

      if (!invite) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "Invalid or expired token. Ask admin to resend an invite.",
          token: "",
          email: "",
        });
      }

      // ✅ user must exist in THIS tenant DB
      const user = await User.findOne({
        _id: invite.userId,
        deletedAt: null,
      }).select("_id email");
      if (!user) {
        return res.status(400).render("tenant/auth/set-password", {
          error: "User not found for this invite.",
          token: "",
          email: "",
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // ✅ Activate user + invalidate old JWT sessions
      await User.updateOne(
        { _id: user._id, deletedAt: null },
        {
          $set: { passwordHash, status: "active" },
          $inc: { tokenVersion: 1 },
        },
      );

      // ✅ Revoke any other unused invites for this user
      await InviteToken.updateMany(
        {
          userId: user._id,
          purpose: "set_password",
          usedAt: null,
          revokedAt: null,
        },
        { $set: { revokedAt: now } },
      );

      return res.redirect("/login");
    } catch (err) {
      console.error("SET PASSWORD ERROR:", err);
      return res.status(500).render("tenant/auth/set-password", {
        error: err?.message || "Failed to set password",
        token: rawToken,
        email: "",
      });
    }
  },
};
