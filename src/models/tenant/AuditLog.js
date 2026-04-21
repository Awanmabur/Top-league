const mongoose = require("mongoose");

module.exports = function AuditLogModel(conn) {
  if (!conn) throw new Error("AuditLog model requires a DB connection");

  const AuditLogSchema = new mongoose.Schema(
    {
      actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      actorName: { type: String, trim: true, default: "" },
      actorEmail: { type: String, trim: true, lowercase: true, default: "" },

      action: { type: String, required: true, trim: true },
      module: { type: String, required: true, trim: true },

      entityType: { type: String, trim: true, default: "" },
      entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
      entityLabel: { type: String, trim: true, default: "" },

      severity: {
        type: String,
        enum: ["Info", "Warning", "Critical"],
        default: "Info",
      },

      ipAddress: { type: String, trim: true, default: "" },
      source: { type: String, trim: true, default: "" },

      metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
      before: { type: mongoose.Schema.Types.Mixed, default: null },
      after: { type: mongoose.Schema.Types.Mixed, default: null },

      reviewed: { type: Boolean, default: false },
      reviewedAt: { type: Date, default: null },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  AuditLogSchema.index({ createdAt: -1 });
  AuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
  AuditLogSchema.index({ actorName: 1, createdAt: -1 });
  AuditLogSchema.index({ action: 1, module: 1, createdAt: -1 });
  AuditLogSchema.index({ module: 1, severity: 1, createdAt: -1 });
  AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
  AuditLogSchema.index({ reviewed: 1, createdAt: -1 });

  return conn.models.AuditLog || conn.model("AuditLog", AuditLogSchema);
};
