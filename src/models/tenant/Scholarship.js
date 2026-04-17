const mongoose = require("mongoose");

module.exports = function ScholarshipModel(conn) {
  if (!conn) throw new Error("Scholarship model requires a DB connection");

  const ScholarshipSchema = new mongoose.Schema(
    {
      name: { type: String, trim: true, required: true },
      code: { type: String, trim: true, default: "" },

      studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        default: null,
      },

      programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subject",
        default: null,
      },

      type: {
        type: String,
        enum: ["Percentage", "Fixed Amount", "Full"],
        default: "Fixed Amount",
      },

      value: { type: Number, default: 0, min: 0 },
      amount: { type: Number, default: 0, min: 0 },

      sponsor: { type: String, trim: true, default: "" },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },

      status: {
        type: String,
        enum: ["Active", "Inactive", "Expired", "Revoked"],
        default: "Active",
      },

      notes: { type: String, trim: true, default: "" },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  ScholarshipSchema.index({ name: 1 });
  ScholarshipSchema.index({ studentId: 1, status: 1 });
  ScholarshipSchema.index({ programId: 1 });
  ScholarshipSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Scholarship || conn.model("Scholarship", ScholarshipSchema);
};
