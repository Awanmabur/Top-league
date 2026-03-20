const mongoose = require("mongoose");

module.exports = function ApiIntegrationModel(conn) {
  if (!conn) throw new Error("ApiIntegration model requires a DB connection");

  const RequestLogSchema = new mongoose.Schema(
    {
      endpoint: { type: String, trim: true, default: "" },
      method: { type: String, trim: true, default: "GET" },
      status: {
        type: String,
        enum: ["Success", "Failed"],
        default: "Success",
      },
      responseTime: { type: String, trim: true, default: "—" },
      message: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const ApiIntegrationSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 220 },
      type: {
        type: String,
        enum: ["Payments", "Messaging", "Storage", "Authentication", "Analytics", "Custom"],
        default: "Custom",
      },
      provider: { type: String, trim: true, default: "" },
      baseUrl: { type: String, trim: true, default: "" },
      authType: {
        type: String,
        enum: ["API Key", "Bearer Token", "Basic Auth", "OAuth2", "None"],
        default: "API Key",
      },
      status: {
        type: String,
        enum: ["Active", "Disabled", "Error"],
        default: "Active",
      },
      apiKey: { type: String, trim: true, default: "" },
      endpoint: { type: String, trim: true, default: "" },
      notes: { type: String, trim: true, default: "" },
      lastTestAt: { type: Date, default: null },
      metrics: {
        requests: { type: Number, default: 0 },
        success: { type: Number, default: 0 },
        failures: { type: Number, default: 0 },
        avgResponse: { type: String, default: "—" },
      },
      requestLogs: { type: [RequestLogSchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  ApiIntegrationSchema.index({ createdAt: -1 });
  ApiIntegrationSchema.index({ status: 1, type: 1, provider: 1, createdAt: -1 });

  return conn.models.ApiIntegration || conn.model("ApiIntegration", ApiIntegrationSchema);
};