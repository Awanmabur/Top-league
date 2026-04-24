const { platformConnection } = require("../../config/db");

const PlatformSetting = require("../../models/platform/PlatformSetting")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "PlatformSetting",
      entityId: payload.entityId ? String(payload.entityId) : "",
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("❌ settings audit log failed:", err);
  }
}

async function upsertSetting(key, group, value, updatedBy) {
  return PlatformSetting.findOneAndUpdate(
    { key },
    {
      $set: {
        key,
        group,
        value,
        updatedBy: updatedBy || null,
      },
    },
    { new: true, upsert: true }
  );
}

module.exports = {
  settingsPage: async (req, res) => {
    try {
      const settings = await PlatformSetting.find({})
        .sort({ group: 1, key: 1 })
        .lean();

      const map = {};
      for (const item of settings) map[item.key] = item.value;

      return res.render("platform/settings/index", {
        settings,
        values: map,
        error: null,
      });
    } catch (err) {
      console.error("❌ settingsPage error:", err);
      return res.status(500).render("platform/settings/index", {
        settings: [],
        values: {},
        error: "Failed to load platform settings.",
      });
    }
  },

  updateGeneralSettings: async (req, res) => {
    try {
      await upsertSetting("platform_name", "general", req.body.platform_name || "Classic Academy", req.user?._id);
      await upsertSetting("base_domain", "general", req.body.base_domain || "", req.user?._id);
      await upsertSetting("default_timezone", "general", req.body.default_timezone || "Africa/Kampala", req.user?._id);
      await upsertSetting("default_currency", "general", req.body.default_currency || "USD", req.user?._id);

      await writeAudit(req, {
        action: "Update General Settings",
        description: "Updated platform general settings",
      });

      return res.redirect("/super-admin/settings");
    } catch (err) {
      console.error("❌ updateGeneralSettings error:", err);
      return res.status(500).send("Failed to update general settings.");
    }
  },

  updateBrandingSettings: async (req, res) => {
    try {
      await upsertSetting("brand_primary_color", "branding", req.body.brand_primary_color || "#0a3d62", req.user?._id);
      await upsertSetting("brand_accent_color", "branding", req.body.brand_accent_color || "#0a6fbf", req.user?._id);
      await upsertSetting("brand_support_email", "branding", req.body.brand_support_email || "", req.user?._id);

      await writeAudit(req, {
        action: "Update Branding Settings",
        description: "Updated platform branding settings",
      });

      return res.redirect("/super-admin/settings");
    } catch (err) {
      console.error("❌ updateBrandingSettings error:", err);
      return res.status(500).send("Failed to update branding settings.");
    }
  },

  updateSecuritySettings: async (req, res) => {
    try {
      const passwordMinLength = Math.max(10, Number(req.body.password_min_length || 10) || 10);
      const sessionTimeoutMinutes = Math.max(15, Number(req.body.session_timeout_minutes || 120) || 120);

      await upsertSetting("password_min_length", "security", passwordMinLength, req.user?._id);
      await upsertSetting("session_timeout_minutes", "security", sessionTimeoutMinutes, req.user?._id);
      await upsertSetting("allow_superadmin_2fa", "security", req.body.allow_superadmin_2fa === "on", req.user?._id);

      await writeAudit(req, {
        action: "Update Security Settings",
        description: "Updated platform security settings",
      });

      return res.redirect("/super-admin/settings");
    } catch (err) {
      console.error("❌ updateSecuritySettings error:", err);
      return res.status(500).send("Failed to update security settings.");
    }
  },
};
