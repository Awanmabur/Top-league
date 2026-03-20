const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const asBool = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

function buildDefaultSettings() {
  return {
    schoolName: "",
    schoolEmail: "",
    schoolPhone: "",
    schoolAddress: "",
    primaryColor: "#0a6fbf",
    secondaryColor: "#0d4060",
    logoUrl: "",
    defaultSenderName: "",
    replyToEmail: "",
    channels: {
      portal: true,
      email: true,
      sms: false,
      push: false,
    },
    portal: {
      allowPublicAdmissions: true,
      requireStudentLogin: true,
      maintenanceMode: false,
    },
    integrations: {
      smtpHost: "",
      smsProvider: "",
      cloudStorage: "",
    },
  };
}

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

module.exports = {
  index: async (req, res) => {
    const { Setting } = req.models;

    let settings = await Setting.findOne({ key: "system", isDeleted: { $ne: true } }).lean();
    settings = settings?.value || buildDefaultSettings();

    return res.render("tenant/admin/settings/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      settings,
      stats: buildStats(settings),
    });
  },

  save: async (req, res) => {
    const { Setting } = req.models;

    const value = {
      schoolName: str(req.body.schoolName),
      schoolEmail: str(req.body.schoolEmail),
      schoolPhone: str(req.body.schoolPhone),
      schoolAddress: str(req.body.schoolAddress),
      primaryColor: str(req.body.primaryColor || "#0a6fbf"),
      secondaryColor: str(req.body.secondaryColor || "#0d4060"),
      logoUrl: str(req.body.logoUrl),
      defaultSenderName: str(req.body.defaultSenderName),
      replyToEmail: str(req.body.replyToEmail),
      channels: {
        portal: asBool(req.body.channelPortal),
        email: asBool(req.body.channelEmail),
        sms: asBool(req.body.channelSms),
        push: asBool(req.body.channelPush),
      },
      portal: {
        allowPublicAdmissions: asBool(req.body.portalAllowPublicAdmissions),
        requireStudentLogin: asBool(req.body.portalRequireStudentLogin),
        maintenanceMode: asBool(req.body.portalMaintenanceMode),
      },
      integrations: {
        smtpHost: str(req.body.smtpHost),
        smsProvider: str(req.body.smsProvider),
        cloudStorage: str(req.body.cloudStorage),
      },
    };

    await Setting.findOneAndUpdate(
      { key: "system", isDeleted: { $ne: true } },
      {
        $set: {
          key: "system",
          value,
          updatedBy: actorUserId(req),
          isDeleted: false,
        },
        $setOnInsert: {
          createdBy: actorUserId(req),
        },
      },
      { upsert: true, new: true }
    );

    req.flash?.("success", "Settings saved successfully.");
    return res.redirect("/admin/settings");
  },
};