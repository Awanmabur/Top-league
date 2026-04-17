// src/models/platform/Plan.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Plan) return connection.models.Plan;

  const PlanSchema = new Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
      },

      code: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 60,
        unique: true,
      },

      description: {
        type: String,
        default: "",
        trim: true,
        maxlength: 1000,
      },

      billingModel: {
        type: String,
        enum: ["school_only", "student_only", "mixed_split"],
        required: true,
      },

      pricePerSchool: {
        type: Number,
        default: 0,
        min: 0,
      },

      pricePerStudent: {
        type: Number,
        default: 0,
        min: 0,
      },

      platformSharePercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },

      currency: {
        type: String,
        default: "USD",
        uppercase: true,
        trim: true,
        maxlength: 10,
      },

      billingInterval: {
        type: String,
        enum: ["monthly", "termly", "semester", "yearly", "custom"],
        default: "monthly",
      },

      trialDays: {
        type: Number,
        default: 0,
        min: 0,
      },

      maxStudents: {
        type: Number,
        default: 0,
        min: 0,
      },

      maxStaff: {
        type: Number,
        default: 0,
        min: 0,
      },

      maxCampuses: {
        type: Number,
        default: 1,
        min: 0,
      },

      enabledModules: [
        {
          type: String,
          trim: true,
        },
      ],

      featureFlags: {
        customDomain: { type: Boolean, default: false },
        apiAccess: { type: Boolean, default: false },
        prioritySupport: { type: Boolean, default: false },
        whiteLabel: { type: Boolean, default: false },
        advancedReports: { type: Boolean, default: false },
        helpdesk: { type: Boolean, default: true },
        backups: { type: Boolean, default: true },
        systemHealth: { type: Boolean, default: true },
      },

      sortOrder: {
        type: Number,
        default: 0,
      },

      isPublic: {
        type: Boolean,
        default: true,
      },

      isActive: {
        type: Boolean,
        default: true,
      },

      isDeleted: {
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

  PlanSchema.index({ isActive: 1, isDeleted: 1, sortOrder: 1 });
  PlanSchema.index({ billingModel: 1, isActive: 1 });

  PlanSchema.pre("validate", function (next) {
    if (this.name && !this.code) {
      this.code = String(this.name).trim().toLowerCase().replace(/\s+/g, "-");
    }
    next();
  });

  return connection.model("Plan", PlanSchema);
};
