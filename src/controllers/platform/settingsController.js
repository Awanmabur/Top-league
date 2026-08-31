const { platformConnection } = require("../../config/db");

const PlatformConfig = require("../../models/platform/PlatformConfig")(platformConnection);
const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const {
  DEFAULT_CONFIG,
  normalizeGeneral,
  normalizeBranding,
  normalizeSecurity,
  flattenConfig,
} = require("../../services/platformConfigService");
const { invalidatePlatformUser, invalidatePlatformSecurityConfig } = require("../../services/platformGuardCache");

function positiveRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("A current positive revision is required.");
  return revision;
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: "PlatformConfig",
      entityId: payload.entityId ? String(payload.entityId) : "platform",
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("Platform settings audit log failed:", err);
  }
}

async function getOrCreateConfig() {
  let config = await PlatformConfig.findOne({ singletonKey: "platform" });
  if (config) return config;
  try {
    config = await PlatformConfig.create({
      singletonKey: "platform",
      revision: 1,
      general: { ...DEFAULT_CONFIG.general },
      branding: { ...DEFAULT_CONFIG.branding },
      security: { ...DEFAULT_CONFIG.security },
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    config = await PlatformConfig.findOne({ singletonKey: "platform" });
  }
  return config;
}

function snapshotList(config) {
  return [
    { key: "platform_name", group: "general" },
    { key: "base_domain", group: "general" },
    { key: "default_timezone", group: "general" },
    { key: "default_currency", group: "general" },
    { key: "brand_primary_color", group: "branding" },
    { key: "brand_accent_color", group: "branding" },
    { key: "brand_support_email", group: "branding" },
    { key: "password_min_length", group: "security" },
    { key: "session_timeout_minutes", group: "security" },
    { key: "require_superadmin_email_2fa", group: "security" },
  ].map((item) => ({ ...item, revision: Number(config.revision || 1) }));
}

async function casUpdate(req, res, field, value, auditAction, auditDescription) {
  const revision = positiveRevision(req.body.revision);
  const updated = await PlatformConfig.findOneAndUpdate(
    { singletonKey: "platform", revision },
    { $set: { [field]: value, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
    { new: true, runValidators: true },
  );
  if (!updated) return res.status(409).send("Platform settings changed in another session. Reload and try again.");
  await invalidatePlatformSecurityConfig().catch(() => {});
  await writeAudit(req, { action: auditAction, entityId: updated._id, description: auditDescription, meta: { revision: updated.revision } });
  return res.redirect("/super-admin/settings");
}

module.exports = {
  settingsPage: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const config = await getOrCreateConfig();
      return res.render("platform/settings/index", {
        config: config.toObject ? config.toObject() : config,
        settings: snapshotList(config),
        values: flattenConfig(config),
        revision: Number(config.revision || 1),
        error: null,
      });
    } catch (err) {
      console.error("settingsPage error:", err);
      return res.status(500).render("platform/settings/index", {
        config: null,
        settings: [],
        values: flattenConfig(DEFAULT_CONFIG),
        revision: 1,
        error: "Failed to load platform settings.",
      });
    }
  },

  updateGeneralSettings: async (req, res) => {
    try {
      await getOrCreateConfig();
      const general = normalizeGeneral(req.body);
      return casUpdate(req, res, "general", general, "Update General Settings", "Updated platform general settings");
    } catch (err) {
      console.error("updateGeneralSettings error:", err);
      return res.status(400).send(err?.message || "Failed to update general settings.");
    }
  },

  updateBrandingSettings: async (req, res) => {
    try {
      await getOrCreateConfig();
      const branding = normalizeBranding(req.body);
      return casUpdate(req, res, "branding", branding, "Update Branding Settings", "Updated platform branding settings");
    } catch (err) {
      console.error("updateBrandingSettings error:", err);
      return res.status(400).send(err?.message || "Failed to update branding settings.");
    }
  },

  updateSecuritySettings: async (req, res) => {
    const session = await platformConnection.startSession();
    try {
      const current = await getOrCreateConfig();
      const revision = positiveRevision(req.body.revision);
      const security = normalizeSecurity(req.body);
      const previousRequire2fa = !!current.security?.requireSuperadminEmail2fa;
      const nextRequire2fa = !!security.requireSuperadminEmail2fa;
      let updated = null;

      await session.withTransaction(async () => {
        updated = await PlatformConfig.findOneAndUpdate(
          { singletonKey: "platform", revision },
          { $set: { security, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
          { new: true, runValidators: true, session },
        );
        if (!updated) throw Object.assign(new Error("Platform settings changed in another session. Reload and try again."), { code: "STALE_CONFIG" });

        if (previousRequire2fa !== nextRequire2fa) {
          await PlatformUser.updateMany(
            { role: "SuperAdmin", isDeleted: { $ne: true }, isActive: true },
            { $inc: { tokenVersion: 1, revision: 1 } },
            { session },
          );
        }
      });

      await invalidatePlatformSecurityConfig().catch(() => {});
      if (previousRequire2fa !== nextRequire2fa) {
        const adminIds = await PlatformUser.find({ role: "SuperAdmin", isDeleted: { $ne: true } }).select("_id").lean().catch(() => []);
        await Promise.all(adminIds.map((row) => invalidatePlatformUser(row._id).catch(() => {})));
      }
      await writeAudit(req, {
        action: "Update Security Settings",
        entityId: updated._id,
        description: "Updated platform security settings",
        meta: {
          revision: updated.revision,
          passwordMinLength: security.passwordMinLength,
          sessionTimeoutMinutes: security.sessionTimeoutMinutes,
          requireSuperadminEmail2fa: security.requireSuperadminEmail2fa,
        },
      });
      return res.redirect("/super-admin/settings");
    } catch (err) {
      console.error("updateSecuritySettings error:", err);
      return res.status(err?.code === "STALE_CONFIG" ? 409 : 400).send(err?.message || "Failed to update security settings.");
    } finally {
      await session.endSession();
    }
  },
};
