const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { platformConnection } = require("../../config/db");
const { validatePasswordStrength } = require("../../utils/passwordPolicy");
const { sendMail } = require("../../utils/mailer");
const {
  getPlatformDashboardRedirect,
  normalizePlatformRole,
  PLATFORM_ROLES,
} = require("../../utils/platformAccess");
const { loadPlatformConfig, DEFAULT_CONFIG } = require("../../services/platformConfigService");
const { clearPlatformSession } = require("../../middleware/platform/guards");
const { invalidatePlatformUser } = require("../../services/platformGuardCache");

const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const PlatformConfig = require("../../models/platform/PlatformConfig")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function safeTrim(value) {
  return String(value || "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fullName(user = {}) {
  return `${safeTrim(user.firstName)} ${safeTrim(user.lastName)}`.trim();
}

function positiveRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("A current positive revision is required.");
  return revision;
}

function configuredPlatformOrigin(req) {
  const configured = safeTrim(process.env.PLATFORM_SITE_URL || process.env.PUBLIC_SITE_URL || "");
  if (configured) {
    let parsed;
    try {
      parsed = new URL(configured);
    } catch (_) {
      throw new Error("PLATFORM_SITE_URL/PUBLIC_SITE_URL must be a valid absolute URL.");
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Platform public URL must use HTTP(S).");
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new Error("Platform public URL must use HTTPS in production.");
    }
    return parsed.origin;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PLATFORM_SITE_URL or PUBLIC_SITE_URL is required for password-reset links in production.");
  }

  const host = safeTrim(req.get("host"));
  if (!host) throw new Error("Request host is unavailable.");
  return `${req.protocol}://${host}`;
}

function absoluteUrl(req, pathname = "/") {
  const cleanPath = `/${String(pathname || "/").replace(/^\/+/, "")}`;
  return `${configuredPlatformOrigin(req)}${cleanPath}`;
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

function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
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
    console.error("Auth audit log failed:", err);
  }
}

async function securityConfig() {
  const config = await loadPlatformConfig(PlatformConfig);
  return { ...DEFAULT_CONFIG.security, ...(config.security || {}) };
}

async function sendPlatformResetEmail(req, user, rawToken) {
  const name = fullName(user) || "there";
  const resetLink = absoluteUrl(req, `/reset-password/${encodeURIComponent(rawToken)}`);

  await sendMail({
    to: user.email,
    subject: "Classic Academy Platform Password Reset",
    text: [
      `Hello ${name},`,
      "",
      "A password reset was requested for your Classic Academy platform account.",
      `Reset your password here: ${resetLink}`,
      "",
      "This link expires in 30 minutes. If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2 style="margin:0 0 12px 0">Classic Academy Platform Password Reset</h2>
        <p style="margin:0 0 12px 0">Hello ${escapeHtml(name)},</p>
        <p style="margin:0 0 12px 0">A password reset was requested for your Classic Academy platform account.</p>
        <p style="margin:18px 0"><a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:12px 16px;background:#0a6fbf;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">Reset Password</a></p>
        <p style="margin:0 0 12px 0;color:#4b5563">This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

function twoFactorHash(userId, code, expiresAt) {
  const secret = String(process.env.SESSION_SECRET || process.env.DATA_ENCRYPTION_KEY || "");
  if (process.env.NODE_ENV === "production" && secret.length < 16) {
    throw new Error("SESSION_SECRET is required for platform two-factor verification.");
  }
  return crypto
    .createHmac("sha256", secret || "classic-academy-2fa-dev-only")
    .update(`${String(userId)}:${String(code)}:${Number(expiresAt)}`)
    .digest("hex");
}

async function sendTwoFactorEmail(user, code) {
  const name = fullName(user) || "there";
  await sendMail({
    to: user.email,
    subject: "Classic Academy platform sign-in verification",
    text: [
      `Hello ${name},`,
      "",
      `Your Classic Academy platform verification code is: ${code}`,
      "",
      "The code expires in 10 minutes. If you did not attempt to sign in, reset your password and contact another Super Admin.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2>Platform sign-in verification</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:5px">${escapeHtml(code)}</p>
        <p>The code expires in 10 minutes. If you did not attempt to sign in, reset your password and contact another Super Admin.</p>
      </div>
    `,
  });
}

async function finalizeLogin(req, res, user) {
  await PlatformUser.updateOne(
    { _id: user._id, isDeleted: { $ne: true }, isActive: true },
    { $set: { lastLoginAt: new Date(), lastLoginIp: req.ip || "" } },
  );

  await regenerateSession(req);
  req.session.platformUserId = String(user._id);
  const role = normalizePlatformRole(user.role);
  req.session.platformRole = role;
  req.session.platformEmail = user.email;
  req.session.platformName = fullName(user);
  req.session.platformTokenVersion = Number(user.tokenVersion || 0);
  req.session.platformLastActivityAt = Date.now();

  await writeAudit(req, {
    actorId: user._id,
    actorName: fullName(user),
    actorRole: role,
    action: "Platform Login",
    entityId: user._id,
    description: `Platform user ${user.email} logged in`,
  });

  return res.redirect(getPlatformDashboardRedirect(role));
}

async function beginTwoFactor(req, res, user) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const hash = twoFactorHash(user._id, code, expiresAt);

  await regenerateSession(req);
  req.session.platform2faPendingUserId = String(user._id);
  req.session.platform2faTokenVersion = Number(user.tokenVersion || 0);
  req.session.platform2faExpiresAt = expiresAt;
  req.session.platform2faHash = hash;
  req.session.platform2faAttempts = 0;

  try {
    await sendTwoFactorEmail(user, code);
  } catch (err) {
    await destroySession(req);
    throw err;
  }

  return res.redirect("/super-admin/verify-login");
}

module.exports = {
  loginForm: async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.session?.platformUserId) {
      return res.redirect(getPlatformDashboardRedirect(req.session.platformRole));
    }
    if (req.session?.platform2faPendingUserId) return res.redirect("/super-admin/verify-login");

    return res.render("platform/auth/login", { error: null, old: {} });
  },

  login: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const email = safeLower(req.body.email);
      const password = safeTrim(req.body.password);

      if (!email || !password) {
        return res.status(400).render("platform/auth/login", { error: "Email and password are required.", old: req.body });
      }

      const user = await PlatformUser.findOne({ email, isDeleted: { $ne: true } });
      if (!user || !user.isActive || !user.passwordHash) {
        return res.status(401).render("platform/auth/login", { error: "Invalid credentials.", old: { email } });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).render("platform/auth/login", { error: "Invalid credentials.", old: { email } });

      const security = await securityConfig();
      if (normalizePlatformRole(user.role) === "SuperAdmin" && security.requireSuperadminEmail2fa) {
        return beginTwoFactor(req, res, user);
      }

      return finalizeLogin(req, res, user);
    } catch (err) {
      console.error("Platform login error:", err);
      return res.status(500).render("platform/auth/login", { error: "Failed to sign in.", old: { email: safeLower(req.body.email) } });
    }
  },

  twoFactorForm: async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.platform2faPendingUserId) return res.redirect("/login");
    if (Number(req.session.platform2faExpiresAt || 0) <= Date.now()) {
      await clearPlatformSession(req, res);
      return res.redirect("/login");
    }
    return res.render("platform/auth/verify-login", { error: null });
  },

  verifyTwoFactor: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const userId = String(req.session?.platform2faPendingUserId || "");
      const expiresAt = Number(req.session?.platform2faExpiresAt || 0);
      const expectedHash = String(req.session?.platform2faHash || "");
      const attempts = Number(req.session?.platform2faAttempts || 0);
      const code = safeTrim(req.body.code).replace(/\D/g, "");

      if (!userId || !expectedHash || expiresAt <= Date.now() || attempts >= 5) {
        await clearPlatformSession(req, res);
        return res.status(401).render("platform/auth/verify-login", { error: "Verification session expired. Sign in again." });
      }
      if (!/^\d{6}$/.test(code)) {
        req.session.platform2faAttempts = attempts + 1;
        return res.status(400).render("platform/auth/verify-login", { error: "Enter the six-digit verification code." });
      }

      const actualHash = twoFactorHash(userId, code, expiresAt);
      const sameLength = actualHash.length === expectedHash.length;
      const valid = sameLength && crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
      if (!valid) {
        req.session.platform2faAttempts = attempts + 1;
        if (req.session.platform2faAttempts >= 5) {
          await clearPlatformSession(req, res);
          return res.status(401).render("platform/auth/verify-login", { error: "Too many invalid codes. Sign in again." });
        }
        return res.status(401).render("platform/auth/verify-login", { error: "Verification code is invalid." });
      }

      const user = await PlatformUser.findOne({ _id: userId, isDeleted: { $ne: true }, isActive: true });
      if (!user || Number(user.tokenVersion || 0) !== Number(req.session.platform2faTokenVersion || 0)) {
        await clearPlatformSession(req, res);
        return res.status(401).render("platform/auth/verify-login", { error: "Account state changed. Sign in again." });
      }

      return finalizeLogin(req, res, user);
    } catch (err) {
      console.error("Platform 2FA verification error:", err);
      return res.status(500).render("platform/auth/verify-login", { error: "Failed to verify sign-in." });
    }
  },

  logout: async (req, res) => {
    try {
      await writeAudit(req, { action: "Platform Logout", description: "Platform user logged out" });
      await clearPlatformSession(req, res);
      return res.redirect("/login");
    } catch (err) {
      console.error("Platform logout error:", err);
      await clearPlatformSession(req, res);
      return res.redirect("/login");
    }
  },

  listPlatformUsers: async (req, res) => {
    res.set("Cache-Control", "no-store");
    const pageSize = 100;
    const page = Math.max(1, Math.min(100000, Number.parseInt(String(req.query?.page || "1"), 10) || 1));
    const filter = { isDeleted: { $ne: true } };
    const [users, total] = await Promise.all([
      PlatformUser.find(filter)
        .select("firstName lastName name email phone role isActive lastLoginAt revision createdAt")
        .sort({ role: 1, firstName: 1, lastName: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      PlatformUser.countDocuments(filter),
    ]);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return res.render("platform/auth/users", { users, pagination: { page: Math.min(page, pages), pages, total, pageSize }, error: null });
  },

  createPlatformUserForm: async (req, res) => {
    res.set("Cache-Control", "no-store");
    const security = await securityConfig();
    return res.render("platform/auth/create-user", { old: {}, error: null, passwordMinLength: security.passwordMinLength });
  },

  createPlatformUser: async (req, res) => {
    try {
      const { firstName, lastName, email, password, role, phone, isActive } = req.body;
      const cleanFirstName = safeTrim(firstName);
      const cleanLastName = safeTrim(lastName);
      const cleanEmail = safeLower(email);
      const cleanPassword = safeTrim(password);
      const requestedRole = safeTrim(role || "Support");
      const cleanPhone = safeTrim(phone);
      const security = await securityConfig();

      if (!cleanFirstName || !cleanLastName || !cleanEmail || !cleanPassword) {
        return res.status(400).render("platform/auth/create-user", { old: req.body, error: "First name, last name, email and password are required.", passwordMinLength: security.passwordMinLength });
      }
      if (!PLATFORM_ROLES.includes(requestedRole)) {
        return res.status(400).render("platform/auth/create-user", { old: req.body, error: "Platform role is invalid.", passwordMinLength: security.passwordMinLength });
      }

      const passwordError = validatePasswordStrength(cleanPassword, { minLength: security.passwordMinLength });
      if (passwordError) return res.status(400).render("platform/auth/create-user", { old: req.body, error: passwordError, passwordMinLength: security.passwordMinLength });

      const exists = await PlatformUser.findOne({ email: cleanEmail, isDeleted: { $ne: true } }).lean();
      if (exists) return res.status(400).render("platform/auth/create-user", { old: req.body, error: "A platform user with that email already exists.", passwordMinLength: security.passwordMinLength });

      const passwordHash = await bcrypt.hash(cleanPassword, 12);
      const user = await PlatformUser.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        passwordHash,
        role: requestedRole,
        phone: cleanPhone,
        isActive: isActive === "on" || isActive === "true",
        revision: 1,
      });

      await writeAudit(req, {
        action: "Create Platform User",
        entityId: user._id,
        description: `Created platform user ${user.email}`,
        meta: { createdUserEmail: user.email, createdUserRole: user.role },
      });
      return res.redirect("/super-admin/platform-users");
    } catch (err) {
      console.error("Create platform user error:", err);
      const security = await securityConfig().catch(() => DEFAULT_CONFIG.security);
      return res.status(500).render("platform/auth/create-user", { old: req.body, error: err?.message || "Failed to create platform user.", passwordMinLength: security.passwordMinLength });
    }
  },

  updatePlatformUserStatus: async (req, res) => {
    try {
      const targetId = String(req.params.id || "");
      const revision = positiveRevision(req.body.revision);
      const nextActive = ["1", "true", "on", "active"].includes(safeLower(req.body.isActive));
      if (targetId === String(req.user?._id || "") && !nextActive) return res.status(400).send("You cannot deactivate your own platform account.");

      const target = await PlatformUser.findOne({ _id: targetId, isDeleted: { $ne: true } }).lean();
      if (!target) return res.status(404).send("Platform user not found.");
      if (!nextActive && target.role === "SuperAdmin") {
        const activeAdmins = await PlatformUser.countDocuments({ role: "SuperAdmin", isActive: true, isDeleted: { $ne: true } });
        if (activeAdmins <= 1) return res.status(409).send("At least one active Super Admin must remain.");
      }

      const updated = await PlatformUser.findOneAndUpdate(
        { _id: targetId, revision, isDeleted: { $ne: true } },
        { $set: { isActive: nextActive }, $inc: { revision: 1, tokenVersion: 1 } },
        { new: true },
      );
      if (!updated) return res.status(409).send("Platform user changed in another session. Reload and try again.");

      await invalidatePlatformUser(updated._id).catch(() => {});
      await writeAudit(req, { action: "Update Platform User Status", entityId: updated._id, description: `${nextActive ? "Activated" : "Deactivated"} platform user ${updated.email}` });
      return res.redirect("/super-admin/platform-users");
    } catch (err) {
      return res.status(400).send(err?.message || "Failed to update platform user status.");
    }
  },

  updatePlatformUserRole: async (req, res) => {
    try {
      const targetId = String(req.params.id || "");
      const revision = positiveRevision(req.body.revision);
      const nextRole = safeTrim(req.body.role);
      if (!PLATFORM_ROLES.includes(nextRole)) return res.status(400).send("Platform role is invalid.");
      if (targetId === String(req.user?._id || "")) return res.status(400).send("Use another Super Admin to change your own role.");

      const target = await PlatformUser.findOne({ _id: targetId, isDeleted: { $ne: true } }).lean();
      if (!target) return res.status(404).send("Platform user not found.");
      if (target.role === "SuperAdmin" && nextRole !== "SuperAdmin") {
        const activeAdmins = await PlatformUser.countDocuments({ role: "SuperAdmin", isActive: true, isDeleted: { $ne: true } });
        if (target.isActive && activeAdmins <= 1) return res.status(409).send("At least one active Super Admin must remain.");
      }

      const updated = await PlatformUser.findOneAndUpdate(
        { _id: targetId, revision, isDeleted: { $ne: true } },
        { $set: { role: nextRole }, $inc: { revision: 1, tokenVersion: 1 } },
        { new: true },
      );
      if (!updated) return res.status(409).send("Platform user changed in another session. Reload and try again.");

      await invalidatePlatformUser(updated._id).catch(() => {});
      await writeAudit(req, { action: "Update Platform User Role", entityId: updated._id, description: `Changed platform user ${updated.email} role to ${updated.role}`, meta: { role: updated.role } });
      return res.redirect("/super-admin/platform-users");
    } catch (err) {
      return res.status(400).send(err?.message || "Failed to update platform user role.");
    }
  },

  forgotPasswordForm: async (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.render("platform/auth/forgot-password", { error: null, success: null });
  },

  forgotPassword: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const email = safeLower(req.body.email);
      if (!email) return res.status(400).render("platform/auth/forgot-password", { error: "Email is required.", success: null });

      const user = await PlatformUser.findOne({ email, isDeleted: { $ne: true }, isActive: true }).lean();
      if (user) {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = sha256(rawToken);
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        await PlatformUser.updateOne({ _id: user._id }, { $set: { resetPasswordTokenHash: tokenHash, resetPasswordExpiresAt: expiresAt } });
        try {
          await sendPlatformResetEmail(req, user, rawToken);
        } catch (mailErr) {
          await PlatformUser.updateOne(
            { _id: user._id, resetPasswordTokenHash: tokenHash },
            { $set: { resetPasswordTokenHash: "", resetPasswordExpiresAt: null } },
          );
          console.error("Platform forgot-password mail error:", mailErr);
        }
      }

      return res.render("platform/auth/forgot-password", { error: null, success: "If the email exists, a password reset link has been sent." });
    } catch (err) {
      console.error("Platform forgot-password error:", err);
      return res.status(500).render("platform/auth/forgot-password", { error: "Failed to process forgot password.", success: null });
    }
  },

  resetPasswordForm: async (req, res) => {
    res.set("Cache-Control", "no-store");
    const tokenHash = sha256(req.params.token);
    const user = await PlatformUser.findOne({ resetPasswordTokenHash: tokenHash, resetPasswordExpiresAt: { $gt: new Date() }, isDeleted: { $ne: true }, isActive: true }).select("_id").lean();
    const security = await securityConfig();
    return res.status(user ? 200 : 400).render("platform/auth/reset-password", {
      token: req.params.token,
      error: user ? null : "Reset token is invalid or expired.",
      success: null,
      passwordMinLength: security.passwordMinLength,
      tokenValid: !!user,
    });
  },

  resetPassword: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const tokenHash = sha256(req.params.token);
      const password = safeTrim(req.body.password);
      const confirmPassword = safeTrim(req.body.confirmPassword);
      const security = await securityConfig();

      if (!password || password !== confirmPassword) {
        return res.status(400).render("platform/auth/reset-password", { token: req.params.token, error: "Passwords do not match.", success: null, passwordMinLength: security.passwordMinLength, tokenValid: true });
      }
      const passwordError = validatePasswordStrength(password, { minLength: security.passwordMinLength });
      if (passwordError) return res.status(400).render("platform/auth/reset-password", { token: req.params.token, error: passwordError, success: null, passwordMinLength: security.passwordMinLength, tokenValid: true });

      const newPasswordHash = await bcrypt.hash(password, 12);
      const user = await PlatformUser.findOneAndUpdate(
        {
          resetPasswordTokenHash: tokenHash,
          resetPasswordExpiresAt: { $gt: new Date() },
          isDeleted: { $ne: true },
          isActive: true,
        },
        {
          $set: {
            passwordHash: newPasswordHash,
            passwordChangedAt: new Date(),
            resetPasswordTokenHash: "",
            resetPasswordExpiresAt: null,
          },
          $inc: { tokenVersion: 1, revision: 1 },
        },
        { new: true },
      );

      if (!user) return res.status(400).render("platform/auth/reset-password", { token: req.params.token, error: "Reset token is invalid or expired.", success: null, passwordMinLength: security.passwordMinLength, tokenValid: false });

      await invalidatePlatformUser(user._id).catch(() => {});
      await writeAudit(req, { actorId: user._id, actorName: fullName(user), actorRole: user.role, action: "Reset Platform Password", entityId: user._id, description: `Reset password for ${user.email}` });
      return res.redirect("/login");
    } catch (err) {
      console.error("Platform reset-password error:", err);
      const security = await securityConfig().catch(() => DEFAULT_CONFIG.security);
      return res.status(500).render("platform/auth/reset-password", { token: req.params.token, error: "Failed to reset password.", success: null, passwordMinLength: security.passwordMinLength, tokenValid: true });
    }
  },
};
