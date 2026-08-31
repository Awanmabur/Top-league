const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("PlatformIntegrationCredential model requires a mongoose connection");
  if (connection.models.PlatformIntegrationCredential) return connection.models.PlatformIntegrationCredential;

  const schema = new Schema(
    {
      provider: {
        type: String,
        enum: ["google_calendar"],
        required: true,
        immutable: true,
        trim: true,
      },
      status: {
        type: String,
        enum: ["connected", "reconnect_required", "disconnected"],
        default: "disconnected",
        index: true,
      },
      credentialCiphertext: { type: String, default: "", select: false },
      credentialIv: { type: String, default: "", select: false },
      credentialTag: { type: String, default: "", select: false },
      credentialVersion: { type: Number, default: 1, select: false },
      scopes: { type: [String], default: [] },
      calendarId: { type: String, default: "primary", trim: true, maxlength: 500 },
      source: { type: String, enum: ["oauth", "legacy_env", "service_account"], default: "oauth" },
      connectedAt: { type: Date, default: null },
      disconnectedAt: { type: Date, default: null },
      lastValidatedAt: { type: Date, default: null },
      lastSuccessAt: { type: Date, default: null },
      lastFailureAt: { type: Date, default: null },
      lastErrorCode: { type: String, default: "", trim: true, maxlength: 120 },
      lastErrorMessage: { type: String, default: "", trim: true, maxlength: 300 },
      revision: { type: Number, default: 1, min: 1 },
      connectedBy: { type: Schema.Types.ObjectId, ref: "PlatformUser", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "PlatformUser", default: null },
      isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true },
  );

  schema.index({ provider: 1 }, { unique: true, name: "uniq_platform_integration_provider" });
  schema.index({ provider: 1, status: 1, isDeleted: 1 });

  return connection.model("PlatformIntegrationCredential", schema);
};
