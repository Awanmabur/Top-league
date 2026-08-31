const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PlatformConfig) return connection.models.PlatformConfig;

  const GeneralSchema = new Schema(
    {
      platformName: { type: String, default: "Classic Academy", trim: true, maxlength: 120 },
      baseDomain: { type: String, default: "", trim: true, lowercase: true, maxlength: 253 },
      defaultTimezone: { type: String, default: "Africa/Kampala", trim: true, maxlength: 80 },
      defaultCurrency: { type: String, default: "USD", trim: true, uppercase: true, maxlength: 10 },
    },
    { _id: false },
  );

  const BrandingSchema = new Schema(
    {
      primaryColor: { type: String, default: "#0a3d62", trim: true, maxlength: 7 },
      accentColor: { type: String, default: "#0a6fbf", trim: true, maxlength: 7 },
      supportEmail: { type: String, default: "", trim: true, lowercase: true, maxlength: 180 },
    },
    { _id: false },
  );

  const SecuritySchema = new Schema(
    {
      passwordMinLength: { type: Number, default: 10, min: 10, max: 128 },
      sessionTimeoutMinutes: { type: Number, default: 120, min: 15, max: 1440 },
      requireSuperadminEmail2fa: { type: Boolean, default: false },
    },
    { _id: false },
  );

  const PlatformConfigSchema = new Schema(
    {
      singletonKey: { type: String, default: "platform", unique: true, immutable: true, maxlength: 40 },
      revision: { type: Number, default: 1, min: 1 },
      general: { type: GeneralSchema, default: () => ({}) },
      branding: { type: BrandingSchema, default: () => ({}) },
      security: { type: SecuritySchema, default: () => ({}) },
      updatedBy: { type: Schema.Types.ObjectId, ref: "PlatformUser", default: null },
    },
    { timestamps: true },
  );

  PlatformConfigSchema.index({ singletonKey: 1 }, { unique: true, name: "uniq_platform_config_singleton" });

  return connection.model("PlatformConfig", PlatformConfigSchema);
};
