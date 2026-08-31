// src/models/platform/AuditLog.js
const { Schema } = require("mongoose");
const { sanitizeAuditFields } = require("../../services/platformAuditService");

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

      ipHash: {
        type: String,
        default: "",
        trim: true,
        maxlength: 128,
        select: false,
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

  AuditLogSchema.pre("validate", function (next) {
    try {
      const sanitizeIp = this.isNew || this.isModified("ipAddress") || !this.ipHash;
      const sanitized = sanitizeAuditFields({
        ipAddress: this.ipAddress,
        userAgent: this.userAgent,
        meta: this.meta,
      });
      if (sanitizeIp) {
        this.ipAddress = sanitized.ipAddress;
        this.ipHash = sanitized.ipHash;
      }
      this.userAgent = sanitized.userAgent;
      this.meta = sanitized.meta;
      next();
    } catch (err) {
      next(err);
    }
  });

  return connection.model("AuditLog", AuditLogSchema);
};
