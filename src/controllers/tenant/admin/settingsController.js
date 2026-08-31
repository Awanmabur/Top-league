const { sendMail } = require("../../../utils/mailer");
const {
  buildConfigurationReport,
  buildDefaultSettings,
  normalizeSettingsInput,
  normalizeStoredSettings,
  validateSettings,
} = require("../../../services/tenant/settingsService");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

function buildStats(settings) {
  const profileFields = [
    settings.schoolName,
    settings.schoolEmail,
    settings.schoolPhone,
    settings.schoolAddress,
    settings.logoUrl,
    settings.defaultSenderName,
    settings.replyToEmail,
  ];
  const filled = profileFields.filter((x) => String(x || "").trim()).length;
  const profileCompletion = Math.round((filled / profileFields.length) * 100);

  const enabledChannels = ["portal", "email", "sms", "push"].filter((k) => settings.channels?.[k]).length;
  const activePolicies = [
    settings.portal?.allowPublicAdmissions,
    settings.portal?.requireStudentLogin,
    settings.portal?.maintenanceMode,
  ].filter(Boolean).length;
  const integrations = [
    settings.integrations?.smtpHost,
    settings.integrations?.smsProvider,
    settings.integrations?.cloudStorage,
  ].filter((x) => String(x || "").trim()).length;

  return { profileCompletion, enabledChannels, activePolicies, integrations };
}

async function readSystemSettings(req) {
  const { Setting } = req.models;
  const row = await Setting.findOne({ key: "system", isDeleted: { $ne: true } }).lean();
  return normalizeStoredSettings(row?.value || {}, req.tenant);
}

async function saveSystemSettings(req, value) {
  const { Setting } = req.models;
  return Setting.findOneAndUpdate(
    { key: "system", isDeleted: { $ne: true } },
    {
      $set: {
        key: "system",
        value,
        updatedBy: actorUserId(req),
        isDeleted: false,
        deletedAt: null,
      },
      $setOnInsert: {
        createdBy: actorUserId(req),
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

async function resolveTestEmail(req, settings) {
  const direct = String(req.user?.email || "").trim().toLowerCase();
  if (direct) return direct;
  const userId = actorUserId(req);
  if (userId && req.models?.User) {
    const user = await req.models.User.findById(userId).select("email").lean().catch(() => null);
    if (user?.email) return String(user.email).trim().toLowerCase();
  }
  return String(settings.schoolEmail || settings.replyToEmail || "").trim().toLowerCase();
}

module.exports = {
  index: async (req, res) => {
    const settings = await readSystemSettings(req);
    return res.render("tenant/settings/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      settings,
      stats: buildStats(settings),
    });
  },

  save: async (req, res) => {
    const value = normalizeSettingsInput(req.body || {});
    const errors = validateSettings(value);
    if (errors.length) {
      req.flash?.("error", errors.join(" "));
      return res.redirect("/admin/settings");
    }

    await saveSystemSettings(req, value);
    req.flash?.("success", "Settings saved successfully.");
    return res.redirect("/admin/settings");
  },

  resetDefaults: async (req, res) => {
    const defaults = buildDefaultSettings(req.tenant);
    await saveSystemSettings(req, defaults);
    req.flash?.("success", "Settings were reset to safe school defaults.");
    return res.redirect("/admin/settings");
  },

  testConfiguration: async (req, res) => {
    const settings = await readSystemSettings(req);
    const report = buildConfigurationReport(settings);
    if (report.errors.length) {
      req.flash?.("error", `Configuration test failed: ${report.errors.join(" ")}`);
      return res.redirect("/admin/settings?tab=integrations");
    }

    let emailResult = "Email delivery is disabled, so no test email was sent.";
    if (settings.channels.email) {
      const target = await resolveTestEmail(req, settings);
      if (!target) {
        req.flash?.("error", "Configuration test failed: no administrator or school email is available for the SMTP test.");
        return res.redirect("/admin/settings?tab=communication");
      }
      try {
        await sendMail({
          to: target,
          subject: "Classic Academy configuration test",
          text: "Classic Academy successfully verified this tenant's configured email delivery path.",
          html: "<p><strong>Classic Academy configuration test</strong></p><p>Email delivery is working for this tenant.</p>",
          replyTo: settings.replyToEmail || undefined,
          fromName: settings.defaultSenderName || settings.schoolName || undefined,
        });
        emailResult = `A test email was sent to ${target}.`;
      } catch (err) {
        req.flash?.("error", `Configuration test failed: ${err?.message || "SMTP delivery could not be verified."}`);
        return res.redirect("/admin/settings?tab=integrations");
      }
    }

    const warningText = report.warnings.length ? ` Warnings: ${report.warnings.join(" ")}` : "";
    req.flash?.("success", `Configuration test passed. ${emailResult}${warningText}`);
    return res.redirect("/admin/settings?tab=integrations");
  },
};
