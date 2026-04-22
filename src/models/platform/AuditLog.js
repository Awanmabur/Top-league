// src/models/platform/AuditLog.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.AuditLog) {
    return connection.models.AuditLog;
  }

  const AuditLogSchema = new Schema(
    {
      actorId: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },

      actorName: {
        type: String,
        default: "",
        trim: true,
        maxlength: 180,
      },

      actorRole: {
        type: String,
        default: "",
        trim: true,
        maxlength: 80,
      },

      action: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
      },

      entityType: {
        type: String,
        trim: true,
        maxlength: 80,
      },

      entityId: {
        type: String,
        trim: true,
        maxlength: 120,
      },

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
      },

      description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 2000,
      },

      ipAddress: {
        type: String,
        default: "",
        trim: true,
        maxlength: 80,
      },

      userAgent: {
        type: String,
        default: "",
        trim: true,
        maxlength: 400,
      },

      meta: {
        type: Schema.Types.Mixed,
        default: {},
      },
    },
    { timestamps: true }
  );

  AuditLogSchema.index({ createdAt: -1 });
  AuditLogSchema.index({ actorId: 1, createdAt: -1 });
  AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
  AuditLogSchema.index({ entityType: 1, entityId: 1 });
  AuditLogSchema.index({ action: 1, createdAt: -1 });
  AuditLogSchema.index({ actorName: 1, createdAt: -1 });

  return connection.model("AuditLog", AuditLogSchema);
};
