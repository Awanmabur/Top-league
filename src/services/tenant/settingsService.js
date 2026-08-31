function str(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function asBool(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function isEmail(value) {
  const v = str(value, 254);
  if (!v) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isHttpUrl(value) {
  const v = str(value, 1000);
  if (!v) return true;
  try {
    const parsed = new URL(v);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isHexColor(value) {
  const v = str(value, 30);
  return /^#[0-9a-f]{6}$/i.test(v);
}

function tenantProfileDefaults(tenant = {}) {
  const profile = tenant?.settings?.profile || {};
  const contact = profile.contact || {};
  const location = profile.location || {};
  const branding = tenant?.settings?.branding || {};
  const address = contact.addressFull || [location.addressLine1, location.city, location.country].filter(Boolean).join(", ");
  return {
    name: str(tenant?.name || profile.shortName, 160),
    email: str(contact.email || tenant?.email, 254).toLowerCase(),
    phone: str(contact.phone, 60),
    address: str(address, 500),
    logoUrl: str(branding.logoUrl, 1000),
    primaryColor: isHexColor(branding.primaryColor) ? str(branding.primaryColor, 30) : "#0a6fbf",
    secondaryColor: isHexColor(branding.secondaryColor) ? str(branding.secondaryColor, 30) : "#0d4060",
  };
}

function buildDefaultSettings(tenant = {}) {
  const base = tenantProfileDefaults(tenant);
  return {
    schoolName: base.name,
    schoolEmail: base.email,
    schoolPhone: base.phone,
    schoolAddress: base.address,
    primaryColor: base.primaryColor,
    secondaryColor: base.secondaryColor,
    logoUrl: base.logoUrl,
    defaultSenderName: base.name,
    replyToEmail: base.email,
    channels: {
      portal: true,
      email: false,
      sms: false,
      push: false,
    },
    portal: {
      allowPublicAdmissions: true,
      requireStudentLogin: true,
      maintenanceMode: false,
    },
    integrations: {
      smtpHost: str(process.env.SMTP_HOST, 255),
      smsProvider: "",
      cloudStorage: "",
    },
  };
}

function normalizeStoredSettings(value = {}, tenant = {}) {
  const defaults = buildDefaultSettings(tenant);
  return {
    schoolName: str(value.schoolName || defaults.schoolName, 160),
    schoolEmail: str(value.schoolEmail || defaults.schoolEmail, 254).toLowerCase(),
    schoolPhone: str(value.schoolPhone || defaults.schoolPhone, 60),
    schoolAddress: str(value.schoolAddress || defaults.schoolAddress, 500),
    primaryColor: isHexColor(value.primaryColor) ? str(value.primaryColor, 30) : defaults.primaryColor,
    secondaryColor: isHexColor(value.secondaryColor) ? str(value.secondaryColor, 30) : defaults.secondaryColor,
    logoUrl: str(value.logoUrl || defaults.logoUrl, 1000),
    defaultSenderName: str(value.defaultSenderName || defaults.defaultSenderName, 180),
    replyToEmail: str(value.replyToEmail || defaults.replyToEmail, 254).toLowerCase(),
    channels: {
      portal: value.channels?.portal !== false,
      email: value.channels?.email === true,
      sms: value.channels?.sms === true,
      push: value.channels?.push === true,
    },
    portal: {
      allowPublicAdmissions: value.portal?.allowPublicAdmissions !== false,
      requireStudentLogin: value.portal?.requireStudentLogin !== false,
      maintenanceMode: value.portal?.maintenanceMode === true,
    },
    integrations: {
      smtpHost: str(value.integrations?.smtpHost || defaults.integrations.smtpHost, 255),
      smsProvider: str(value.integrations?.smsProvider, 120),
      cloudStorage: str(value.integrations?.cloudStorage, 120),
    },
  };
}

function normalizeSettingsInput(body = {}) {
  return {
    schoolName: str(body.schoolName, 160),
    schoolEmail: str(body.schoolEmail, 254).toLowerCase(),
    schoolPhone: str(body.schoolPhone, 60),
    schoolAddress: str(body.schoolAddress, 500),
    primaryColor: str(body.primaryColor || "#0a6fbf", 30),
    secondaryColor: str(body.secondaryColor || "#0d4060", 30),
    logoUrl: str(body.logoUrl, 1000),
    defaultSenderName: str(body.defaultSenderName, 180),
    replyToEmail: str(body.replyToEmail, 254).toLowerCase(),
    channels: {
      portal: asBool(body.channelPortal),
      email: asBool(body.channelEmail),
      sms: asBool(body.channelSms),
      push: asBool(body.channelPush),
    },
    portal: {
      allowPublicAdmissions: asBool(body.portalAllowPublicAdmissions),
      requireStudentLogin: asBool(body.portalRequireStudentLogin),
      maintenanceMode: asBool(body.portalMaintenanceMode),
    },
    integrations: {
      smtpHost: str(body.smtpHost, 255),
      smsProvider: str(body.smsProvider, 120),
      cloudStorage: str(body.cloudStorage, 120),
    },
  };
}

function validateSettings(settings = {}) {
  const errors = [];
  if (!settings.schoolName) errors.push("School name is required.");
  if (!isEmail(settings.schoolEmail)) errors.push("School email is invalid.");
  if (!isEmail(settings.replyToEmail)) errors.push("Reply-To email is invalid.");
  if (!isHexColor(settings.primaryColor)) errors.push("Primary color must be a 6-digit hex color such as #0a6fbf.");
  if (!isHexColor(settings.secondaryColor)) errors.push("Secondary color must be a 6-digit hex color such as #0d4060.");
  if (!isHttpUrl(settings.logoUrl)) errors.push("Logo URL must use http:// or https://.");
  if (settings.channels?.email && !settings.schoolEmail && !settings.replyToEmail) {
    errors.push("Enable email only after adding a school or Reply-To email address.");
  }
  if (settings.channels?.sms && !settings.integrations?.smsProvider) {
    errors.push("Choose an SMS provider before enabling SMS delivery.");
  }
  return errors;
}

function buildConfigurationReport(settings = {}) {
  const errors = validateSettings(settings);
  const warnings = [];
  const runtimeSmtpHost = str(process.env.SMTP_HOST, 255);

  if (settings.channels?.email) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      errors.push("Email delivery is enabled, but SMTP_HOST/SMTP_USER/SMTP_PASS are not configured in the runtime environment.");
    } else if (settings.integrations?.smtpHost && runtimeSmtpHost && settings.integrations.smtpHost !== runtimeSmtpHost) {
      warnings.push("The saved SMTP host differs from the runtime SMTP_HOST; runtime credentials remain authoritative.");
    }
  }

  if (settings.channels?.push) {
    warnings.push("Push delivery is enabled, but this Settings page does not store a push-provider credential; verify the provider runtime separately.");
  }

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

module.exports = {
  asBool,
  buildConfigurationReport,
  buildDefaultSettings,
  isEmail,
  isHexColor,
  isHttpUrl,
  normalizeSettingsInput,
  normalizeStoredSettings,
  validateSettings,
};
