const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { platformConnection } = require("../../config/db");
const { validatePasswordStrength } = require("../../utils/passwordPolicy");
const {
  getPlatformDashboardRedirect,
  normalizePlatformRole,
} = require("../../utils/platformAccess");

const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function safeLower(v) {
  return String(v || "").trim().toLowerCase();
}

function safeTrim(v) {
  return String(v || "").trim();
}

function sha256(v) {
  return crypto.createHash("sha256").update(String(v || "")).digest("hex");
}

function fullName(user = {}) {
  return `${safeTrim(user.firstName)} ${safeTrim(user.lastName)}`.trim();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.regenerate((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: payload.actorId || req.user?._id || null,
      actorName: payload.actorName || fullName(req.user || {}) || "",
      actorRole: payload.actorRole || req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "PlatformUser",
      entityId: payload.entityId ? String(payload.entityId) : "",
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("âŒ auth audit log failed:", err);
  }
}

module.exports = {
  loginForm: async (req, res) => {
    if (req.session?.platformUserId) {
      return res.redirect(getPlatformDashboardRedirect(req.session.platformRole));
    }

    return res.render("platform/auth/login", {
      error: null,
      old: {},
    });
  },

  login: async (req, res) => {
    try {
      const email = safeLower(req.body.email);
      const password = safeTrim(req.body.password);

      if (!email || !password) {
        return res.status(400).render("platform/auth/login", {
          error: "Email and password are required.",
          old: req.body,
        });
      }

      const user = await PlatformUser.findOne({
        email,
        isDeleted: { $ne: true },
      });

      if (!user || !user.isActive) {
        return res.status(401).render("platform/auth/login", {
          error: "Invalid credentials.",
          old: req.body,
        });
      }

      if (!user.passwordHash) {
        return res.status(401).render("platform/auth/login", {
          error: "Invalid credentials.",
          old: req.body,
        });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return res.status(401).render("platform/auth/login", {
          error: "Invalid credentials.",
          old: req.body,
        });
      }

      await PlatformUser.updateOne(
        { _id: user._id },
        {
          $set: {
            lastLoginAt: new Date(),
            lastLoginIp: req.ip || "",
          },
        }
      );

      await regenerateSession(req);
      req.session.platformUserId = String(user._id);
      const role = normalizePlatformRole(user.role);
      req.session.platformRole = role;
      req.session.platformEmail = user.email;
      req.session.platformName = fullName(user);
      req.session.platformTokenVersion = Number(user.tokenVersion || 0);

      await writeAudit(req, {
        actorId: user._id,
        actorName: fullName(user),
        actorRole: role,
        action: "Platform Login",
        entityId: user._id,
        description: `Platform user ${user.email} logged in`,
      });

      return res.redirect(getPlatformDashboardRedirect(role));
    } catch (err) {
      console.error("âŒ login error:", err);
      return res.status(500).render("platform/auth/login", {
        error: "Failed to sign in.",
        old: req.body,
      });
    }
  },

  logout: async (req, res) => {
    try {
      await writeAudit(req, {
        action: "Platform Logout",
        description: `Platform user logged out`,
      });

      if (!req.session) return res.redirect("/login");

      return req.session.destroy(() => {
        res.clearCookie("platform.sid", { path: "/" });
        return res.redirect("/login");
      });
    } catch (err) {
      console.error("âŒ logout error:", err);
      res.clearCookie("platform.sid", { path: "/" });
      return res.redirect("/login");
    }
  },

  createPlatformUserForm: async (req, res) => {
    return res.render("platform/auth/create-user", {
      old: {},
      error: null,
    });
  },

  createPlatformUser: async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        email,
        password,
        role,
        phone,
        isActive,
      } = req.body;

      const cleanFirstName = safeTrim(firstName);
      const cleanLastName = safeTrim(lastName);
      const cleanEmail = safeLower(email);
      const cleanPassword = safeTrim(password);
      const cleanRole = normalizePlatformRole(role || "Support");
      const cleanPhone = safeTrim(phone);

      if (!cleanFirstName || !cleanLastName || !cleanEmail || !cleanPassword) {
        return res.status(400).render("platform/auth/create-user", {
          old: req.body,
          error: "First name, last name, email and password are required.",
        });
      }

      const passwordError = validatePasswordStrength(cleanPassword, { minLength: 10 });
      if (passwordError) {
        return res.status(400).render("platform/auth/create-user", {
          old: req.body,
          error: passwordError,
        });
      }

      const exists = await PlatformUser.findOne({
        email: cleanEmail,
        isDeleted: { $ne: true },
      }).lean();

      if (exists) {
        return res.status(400).render("platform/auth/create-user", {
          old: req.body,
          error: "A platform user with that email already exists.",
        });
      }

      const passwordHash = await bcrypt.hash(cleanPassword, 12);

      const user = await PlatformUser.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        passwordHash,
        role: cleanRole,
        phone: cleanPhone,
        isActive: isActive === "on" || isActive === "true",
      });

      await writeAudit(req, {
        action: "Create Platform User",
        entityId: user._id,
        actorName: fullName(req.user || {}),
        actorRole: req.user?.role || "",
        description: `Created platform user ${user.email}`,
        meta: {
          createdUserEmail: user.email,
          createdUserRole: user.role,
        },
      });

      return res.redirect("/super-admin/settings");
    } catch (err) {
      console.error("âŒ createPlatformUser error:", err);
      return res.status(500).render("platform/auth/create-user", {
        old: req.body,
        error: err?.message || "Failed to create platform user.",
      });
    }
  },

  forgotPasswordForm: async (req, res) => {
    return res.render("platform/auth/forgot-password", {
      error: null,
      success: null,
    });
  },

  forgotPassword: async (req, res) => {
    try {
      const email = safeLower(req.body.email);

      if (!email) {
        return res.status(400).render("platform/auth/forgot-password", {
          error: "Email is required.",
          success: null,
        });
      }

      const user = await PlatformUser.findOne({
        email,
        isDeleted: { $ne: true },
      }).lean();

      if (user) {
        const rawToken = crypto.randomBytes(24).toString("hex");
        const tokenHash = sha256(rawToken);
        const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

        await PlatformUser.updateOne(
          { _id: user._id },
          {
            $set: {
              resetPasswordTokenHash: tokenHash,
              resetPasswordExpiresAt: expiresAt,
            },
          }
        );

        if (process.env.DEBUG_AUTH_TOKENS === "1") {
          console.log("Platform reset token:", rawToken);
        }
      }

      return res.render("platform/auth/forgot-password", {
        error: null,
        success: "If the email exists, a password reset token has been generated.",
      });
    } catch (err) {
      console.error("âŒ forgotPassword error:", err);
      return res.status(500).render("platform/auth/forgot-password", {
        error: "Failed to process forgot password.",
        success: null,
      });
    }
  },

  resetPasswordForm: async (req, res) => {
      return res.render("platform/auth/reset-password", {
        token: req.params.token,
        error: null,
        success: null,
      });
  },

  resetPassword: async (req, res) => {
    try {
      const tokenHash = sha256(req.params.token);
      const password = safeTrim(req.body.password);
      const confirmPassword = safeTrim(req.body.confirmPassword);

      if (!password || password !== confirmPassword) {
        return res.status(400).render("platform/auth/reset-password", {
          token: req.params.token,
          error: "Passwords do not match.",
          success: null,
        });
      }

      const passwordError = validatePasswordStrength(password, { minLength: 10 });
      if (passwordError) {
        return res.status(400).render("platform/auth/reset-password", {
          token: req.params.token,
          error: passwordError,
          success: null,
        });
      }

      const user = await PlatformUser.findOne({
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { $gt: new Date() },
        isDeleted: { $ne: true },
      });

      if (!user) {
        return res.status(400).render("platform/auth/reset-password", {
          token: req.params.token,
          error: "Reset token is invalid or expired.",
          success: null,
        });
      }

      const newPasswordHash = await bcrypt.hash(password, 12);

      await PlatformUser.updateOne(
        { _id: user._id },
        {
          $set: {
            passwordHash: newPasswordHash,
            passwordChangedAt: new Date(),
            resetPasswordTokenHash: "",
            resetPasswordExpiresAt: null,
            tokenVersion: (user.tokenVersion || 0) + 1,
          },
        }
      );

      await writeAudit(req, {
        actorId: user._id,
        actorName: fullName(user),
        actorRole: user.role,
        action: "Reset Platform Password",
        entityId: user._id,
        description: `Reset password for ${user.email}`,
      });

      return res.redirect("/login");
    } catch (err) {
      console.error("âŒ resetPassword error:", err);
      return res.status(500).render("platform/auth/reset-password", {
        token: req.params.token,
        error: "Failed to reset password.",
        success: null,
      });
    }
  },
};

