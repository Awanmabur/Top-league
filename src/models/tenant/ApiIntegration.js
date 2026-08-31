const mongoose = require("mongoose");
module.exports = function ApiIntegrationModel(conn) {
  if (!conn) throw new Error("ApiIntegration model requires a DB connection");
  const RequestLogSchema = new mongoose.Schema({
    endpoint: { type: String, trim: true, default: "", maxlength: 500 },
    method: { type: String, enum: ["HEAD", "GET"], default: "HEAD" },
    status: { type: String, enum: ["Success", "Failed"], default: "Success" },
    statusCode: { type: Number, default: 0, min: 0, max: 599 },
    responseTimeMs: { type: Number, default: 0, min: 0, max: 600000 },
    message: { type: String, trim: true, default: "", maxlength: 220 },
    createdAt: { type: Date, default: Date.now },
  }, { _id: true });
  const ApiIntegrationSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 220 },
    type: { type: String, enum: ["Payments", "Messaging", "Storage", "Authentication", "Analytics", "Custom"], default: "Custom" },
    provider: { type: String, trim: true, default: "", maxlength: 180 },
    baseUrl: { type: String, trim: true, default: "", maxlength: 500 },
    authType: { type: String, enum: ["API Key", "Bearer Token", "Basic Auth", "OAuth2", "None"], default: "API Key" },
    status: { type: String, enum: ["Active", "Disabled", "Error"], default: "Disabled", index: true },
    apiKey: { type: String, trim: true, default: "", select: false },
    credentialCiphertext: { type: String, default: "", select: false },
    credentialIv: { type: String, default: "", select: false },
    credentialTag: { type: String, default: "", select: false },
    credentialVersion: { type: Number, default: 1, select: false },
    endpoint: { type: String, trim: true, default: "/", maxlength: 500 },
    testMethod: { type: String, enum: ["HEAD", "GET"], default: "HEAD" },
    notes: { type: String, trim: true, default: "", maxlength: 1200 },
    lastTestAt: { type: Date, default: null },
    lastTestStatus: { type: String, enum: ["Success", "Failed", "Never"], default: "Never", index: true },
    lastStatusCode: { type: Number, default: 0 },
    metrics: {
      requests: { type: Number, default: 0, min: 0 },
      success: { type: Number, default: 0, min: 0 },
      failures: { type: Number, default: 0, min: 0 },
      avgResponseMs: { type: Number, default: 0, min: 0 },
    },
    requestLogs: { type: [RequestLogSchema], default: [] },
    revision: { type: Number, default: 0, min: 0 },
    migrationQuarantinedAt: { type: Date, default: null, index: true },
    migrationQuarantineReason: { type: String, trim: true, default: "", maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  }, { timestamps: true });
  ApiIntegrationSchema.index({ createdAt: -1 });
  ApiIntegrationSchema.index({ isDeleted: 1, migrationQuarantinedAt: 1, status: 1, type: 1, provider: 1, createdAt: -1 });
  ApiIntegrationSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, migrationQuarantinedAt: null } });
  return conn.models.ApiIntegration || conn.model("ApiIntegration", ApiIntegrationSchema);
};
