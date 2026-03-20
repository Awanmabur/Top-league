const mongoose = require("mongoose");

module.exports = function StaffRoleModel(conn) {
  if (!conn) throw new Error("StaffRole model requires a DB connection");

  const StaffRoleSchema = new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
      },

      code: {
        type: String,
        trim: true,
        default: "",
        maxlength: 80,
      },

      description: {
        type: String,
        trim: true,
        default: "",
        maxlength: 3000,
      },

      status: {
        type: String,
        enum: ["Active", "Inactive"],
        default: "Active",
      },

      permissions: {
        type: [String],
        default: [],
      },

      usersCount: {
        type: Number,
        default: 0,
        min: 0,
      },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      isDeleted: {
        type: Boolean,
        default: false,
      },

      deletedAt: {
        type: Date,
        default: null,
      },
    },
    { timestamps: true }
  );

  StaffRoleSchema.index({ name: 1, isDeleted: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
  StaffRoleSchema.index({ status: 1, createdAt: -1 });
  StaffRoleSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.StaffRole || conn.model("StaffRole", StaffRoleSchema);
};