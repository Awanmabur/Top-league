// src/models/platform/PlatformAnnouncement.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PlatformAnnouncement) {
    return connection.models.PlatformAnnouncement;
  }

  const PlatformAnnouncementSchema = new Schema(
    {
      title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
      },

      body: {
        type: String,
        required: true,
        trim: true,
        maxlength: 10000,
      },

      audience: {
        type: String,
        enum: ["all", "active", "trial", "suspended", "custom"],
        default: "all",
      },

      tenantIds: [
        {
          type: Schema.Types.ObjectId,
          ref: "Tenant",
        },
      ],

      status: {
        type: String,
        enum: ["draft", "scheduled", "published", "archived"],
        default: "draft",
      },

      channel: {
        type: String,
        enum: ["dashboard", "email", "sms", "mixed"],
        default: "dashboard",
      },

      publishAt: {
        type: Date,
      },

      publishedAt: {
        type: Date,
      },

      expiresAt: {
        type: Date,
      },

      pinned: {
        type: Boolean,
        default: false,
      },

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },
    },
    { timestamps: true }
  );

  PlatformAnnouncementSchema.index({ status: 1, publishAt: -1 });
  PlatformAnnouncementSchema.index({ audience: 1, status: 1 });

  return connection.model("PlatformAnnouncement", PlatformAnnouncementSchema);
};