const DEFAULT_CONFIG = Object.freeze({
  general: Object.freeze({
    platformName: "Classic Academy",
    baseDomain: "",
    defaultTimezone: "Africa/Kampala",
    defaultCurrency: "USD",
  }),
  branding: Object.freeze({
    primaryColor: "#0a3d62",
    accentColor: "#0a6fbf",
    supportEmail: "",
  }),
  security: Object.freeze({
    passwordMinLength: 10,
    sessionTimeoutMinutes: 120,
    requireSuperadminEmail2fa: false,
  }),
});

function text(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function intInRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

function bool(value) {
  if (value === true || value === 1) return true;
  return ["1", "true", "yes", "on"].includes(text(value, 20).toLowerCase());
}

function validTimezone(zone) {
  const value = text(zone, 80);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch (_) {
    throw new Error("Default timezone is invalid.");
  }
}

function normalizeDomain(value) {
  const domain = text(value, 253).toLowerCase().replace(/\.$/, "");
  if (!domain) return "";
  if (/[:/\\\s]/.test(domain) || !/^[a-z0-9.-]+$/.test(domain) || domain.startsWith(".") || domain.endsWith(".")) {
    throw new Error("Base domain must be a hostname without protocol, path, port, or spaces.");
  }
  return domain;
}

function normalizeCurrency(value) {
  const currency = text(value || "USD", 10).toUpperCase();
  if (!/^[A-Z]{3,10}$/.test(currency)) throw new Error("Default currency is invalid.");
  return currency;
}

function normalizeColor(value, fallback) {
  const color = text(value || fallback, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Brand colors must use six-digit hexadecimal notation.");
  return color.toLowerCase();
}

function normalizeEmail(value) {
  const email = text(value, 180).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Support email is invalid.");
  return email;
}

function normalizeGeneral(input = {}) {
  const platformName = text(input.platformName ?? input.platform_name ?? DEFAULT_CONFIG.general.platformName, 120);
  if (platformName.length < 2) throw new Error("Platform name is required.");
  return {
    platformName,
    baseDomain: normalizeDomain(input.baseDomain ?? input.base_domain ?? ""),
    defaultTimezone: validTimezone(input.defaultTimezone ?? input.default_timezone ?? DEFAULT_CONFIG.general.defaultTimezone),
    defaultCurrency: normalizeCurrency(input.defaultCurrency ?? input.default_currency ?? DEFAULT_CONFIG.general.defaultCurrency),
  };
}

function normalizeBranding(input = {}) {
  return {
    primaryColor: normalizeColor(input.primaryColor ?? input.brand_primary_color, DEFAULT_CONFIG.branding.primaryColor),
    accentColor: normalizeColor(input.accentColor ?? input.brand_accent_color, DEFAULT_CONFIG.branding.accentColor),
    supportEmail: normalizeEmail(input.supportEmail ?? input.brand_support_email ?? ""),
  };
}

function normalizeSecurity(input = {}) {
  return {
    passwordMinLength: intInRange(input.passwordMinLength ?? input.password_min_length ?? DEFAULT_CONFIG.security.passwordMinLength, 10, 128, "Password minimum length"),
    sessionTimeoutMinutes: intInRange(input.sessionTimeoutMinutes ?? input.session_timeout_minutes ?? DEFAULT_CONFIG.security.sessionTimeoutMinutes, 15, 1440, "Session timeout"),
    requireSuperadminEmail2fa: bool(input.requireSuperadminEmail2fa ?? input.require_superadmin_email_2fa ?? input.allow_superadmin_2fa),
  };
}

function flattenConfig(config = {}) {
  const general = { ...DEFAULT_CONFIG.general, ...(config.general || {}) };
  const branding = { ...DEFAULT_CONFIG.branding, ...(config.branding || {}) };
  const security = { ...DEFAULT_CONFIG.security, ...(config.security || {}) };
  return {
    platform_name: general.platformName,
    base_domain: general.baseDomain,
    default_timezone: general.defaultTimezone,
    default_currency: general.defaultCurrency,
    brand_primary_color: branding.primaryColor,
    brand_accent_color: branding.accentColor,
    brand_support_email: branding.supportEmail,
    password_min_length: security.passwordMinLength,
    session_timeout_minutes: security.sessionTimeoutMinutes,
    require_superadmin_email_2fa: !!security.requireSuperadminEmail2fa,
    allow_superadmin_2fa: !!security.requireSuperadminEmail2fa,
  };
}

async function loadPlatformConfig(PlatformConfig, { lean = true } = {}) {
  let query = PlatformConfig.findOne({ singletonKey: "platform" });
  if (lean) query = query.lean();
  const found = await query;
  if (found) return found;
  return {
    singletonKey: "platform",
    revision: 1,
    general: { ...DEFAULT_CONFIG.general },
    branding: { ...DEFAULT_CONFIG.branding },
    security: { ...DEFAULT_CONFIG.security },
  };
}

module.exports = {
  DEFAULT_CONFIG,
  text,
  bool,
  normalizeDomain,
  normalizeCurrency,
  normalizeGeneral,
  normalizeBranding,
  normalizeSecurity,
  flattenConfig,
  loadPlatformConfig,
};
