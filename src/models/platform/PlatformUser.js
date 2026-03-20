// src/models/platform/PlatformUser.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PlatformUser) {
    return connection.models.PlatformUser;
  }

  const PlatformUserSchema = new Schema(
    {
      firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80,
      },

      lastName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80,
      },

      name: {
        type: String,
        trim: true,
        maxlength: 180,
      },

      email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true,
        maxlength: 180,
      },

      passwordHash: {
        type: String,
        required: true,
      },

      role: {
        type: String,
        enum: ["SuperAdmin", "Support", "Sales", "Finance", "Operations"],
        default: "SuperAdmin",
      },

      permissions: [
        {
          type: String,
          trim: true,
        },
      ],

      phone: {
        type: String,
        trim: true,
        maxlength: 40,
      },

      avatarUrl: {
        type: String,
        default: "",
        trim: true,
      },

      lastLoginAt: {
        type: Date,
      },

      lastLoginIp: {
        type: String,
        trim: true,
        maxlength: 80,
      },

      passwordChangedAt: {
        type: Date,
      },

      resetPasswordTokenHash: {
        type: String,
        default: "",
      },

      resetPasswordExpiresAt: {
        type: Date,
      },

      tokenVersion: {
        type: Number,
        default: 0,
      },

      isActive: {
        type: Boolean,
        default: true,
      },

      isDeleted: {
        type: Boolean,
        default: false,
      },
    },
    { timestamps: true }
  );

  PlatformUserSchema.index({ role: 1, isActive: 1, isDeleted: 1 });

  PlatformUserSchema.pre("validate", function (next) {
    const full = `${this.firstName || ""} ${this.lastName || ""}`.trim();
    if (full) this.name = full;
    next();
  });

  return connection.model("PlatformUser", PlatformUserSchema);
};