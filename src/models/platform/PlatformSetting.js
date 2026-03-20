// src/models/platform/PlatformSetting.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PlatformSetting) {
    return connection.models.PlatformSetting;
  }

  const PlatformSettingSchema = new Schema(
    {
      key: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        maxlength: 120,
      },

      group: {
        type: String,
        default: "general",
        trim: true,
        maxlength: 80,
      },

      value: {
        type: Schema.Types.Mixed,
        default: null,
      },

      description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 500,
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },
    },
    { timestamps: true }
  );

  PlatformSettingSchema.index({ group: 1, updatedAt: -1 });

  return connection.model("PlatformSetting", PlatformSettingSchema);
};