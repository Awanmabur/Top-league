const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConfigurationReport,
  buildDefaultSettings,
  normalizeSettingsInput,
  normalizeStoredSettings,
  validateSettings,
} = require("../src/services/tenant/settingsService");

test("Settings defaults inherit safe tenant identity and branding without enabling external channels", () => {
  const tenant = {
    name: "Test Academy",
    email: "office@example.edu",
    settings: {
      branding: { primaryColor: "#123456", secondaryColor: "#abcdef", logoUrl: "https://example.edu/logo.png" },
      profile: { contact: { phone: "+256700000000", email: "school@example.edu", addressFull: "Kampala" } },
    },
  };
  const value = buildDefaultSettings(tenant);
  assert.equal(value.schoolName, "Test Academy");
  assert.equal(value.schoolEmail, "school@example.edu");
  assert.equal(value.primaryColor, "#123456");
  assert.equal(value.secondaryColor, "#abcdef");
  assert.equal(value.channels.portal, true);
  assert.equal(value.channels.email, false);
  assert.equal(value.channels.sms, false);
  assert.equal(value.channels.push, false);
});

test("Settings input normalization bounds strings and converts explicit form booleans", () => {
  const value = normalizeSettingsInput({
    schoolName: `  ${"A".repeat(220)}  `,
    schoolEmail: " ADMIN@EXAMPLE.EDU ",
    channelPortal: "true",
    channelEmail: "on",
    channelSms: "false",
    portalMaintenanceMode: "yes",
    smsProvider: " provider ",
  });
  assert.equal(value.schoolName.length, 160);
  assert.equal(value.schoolEmail, "admin@example.edu");
  assert.equal(value.channels.portal, true);
  assert.equal(value.channels.email, true);
  assert.equal(value.channels.sms, false);
  assert.equal(value.portal.maintenanceMode, true);
  assert.equal(value.integrations.smsProvider, "provider");
});

test("Settings validation rejects malformed operational values and SMS without a provider", () => {
  const value = normalizeSettingsInput({
    schoolName: "Academy",
    schoolEmail: "not-an-email",
    replyToEmail: "bad",
    primaryColor: "red",
    secondaryColor: "#12345z",
    logoUrl: "javascript:alert(1)",
    channelSms: "true",
  });
  const errors = validateSettings(value).join(" ");
  assert.match(errors, /School email is invalid/);
  assert.match(errors, /Reply-To email is invalid/);
  assert.match(errors, /Primary color/);
  assert.match(errors, /Secondary color/);
  assert.match(errors, /Logo URL/);
  assert.match(errors, /SMS provider/);
});

test("Stored Settings are normalized against tenant defaults instead of trusted blindly", () => {
  const value = normalizeStoredSettings(
    { primaryColor: "expression(alert(1))", schoolName: "Stored", channels: { portal: false, email: true } },
    { name: "Tenant" }
  );
  assert.equal(value.schoolName, "Stored");
  assert.equal(value.primaryColor, "#0a6fbf");
  assert.equal(value.channels.portal, false);
  assert.equal(value.channels.email, true);
});

test("Configuration report fails closed when email is enabled without runtime SMTP credentials", () => {
  const old = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  try {
    const value = normalizeSettingsInput({
      schoolName: "Academy",
      schoolEmail: "school@example.edu",
      primaryColor: "#0a6fbf",
      secondaryColor: "#0d4060",
      channelEmail: "true",
    });
    const report = buildConfigurationReport(value);
    assert.match(report.errors.join(" "), /SMTP_HOST\/SMTP_USER\/SMTP_PASS/);
  } finally {
    if (old.host === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = old.host;
    if (old.user === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = old.user;
    if (old.pass === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = old.pass;
  }
});
