const mongoose = require("mongoose");

module.exports = function SystemHealthModel(conn) {
  if (!conn) throw new Error("SystemHealth model requires a DB connection");

  const IncidentSchema = new mongoose.Schema(
    {
      actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      actorName: { type: String, trim: true, default: "" },
      type: {
        type: String,
        enum: ["Incident", "Maintenance"],
        default: "Incident",
      },
      status: {
        type: String,
        enum: ["Open", "Resolved", "Maintenance"],
        default: "Open",
      },
      note: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const SystemHealthSchema = new mongoose.Schema(
    {
      serviceName: { type: String, required: true, trim: true, maxlength: 220 },
      type: {
        type: String,
        enum: ["Application", "Database", "Storage", "Queue", "Integration"],
        default: "Application",
      },
      region: { type: String, trim: true, default: "" },
      host: { type: String, trim: true, default: "" },
      endpoint: { type: String, trim: true, default: "" },
      status: {
        type: String,
        enum: ["Healthy", "Warning", "Critical", "Maintenance"],
        default: "Healthy",
      },
      metrics: {
        uptime: { type: String, default: "0%" },
        latency: { type: String, default: "—" },
        load: { type: String, default: "—" },
        errorRate: { type: String, default: "0%" },
        cpu: { type: String, default: "—" },
        memory: { type: String, default: "—" },
      },
      notes: { type: String, trim: true, default: "" },
      lastCheckedAt: { type: Date, default: null },
      lastIncidentAt: { type: Date, default: null },
      incidents: { type: [IncidentSchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  SystemHealthSchema.index({ createdAt: -1 });
  SystemHealthSchema.index({ status: 1, type: 1, region: 1, createdAt: -1 });
  SystemHealthSchema.index({ isDeleted: 1, type: 1 });

  return conn.models.SystemHealth || conn.model("SystemHealth", SystemHealthSchema);
};
