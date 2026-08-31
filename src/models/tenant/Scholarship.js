const mongoose = require("mongoose");

module.exports = function ScholarshipModel(conn) {
  if (!conn) throw new Error("Scholarship model requires a DB connection");

  const ScholarshipSchema = new mongoose.Schema(
    {
      name: { type: String, trim: true, required: true, maxlength: 180 },
      code: { type: String, trim: true, default: "", maxlength: 80 },
      recordKind: { type: String, enum: ["Program", "Award"], default: "Program", index: true },
      sourceScholarshipId: { type: mongoose.Schema.Types.ObjectId, ref: "Scholarship", default: null, index: true },
      sourceApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: "ScholarshipApplication", default: null },

      studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        default: null,
      },

      programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Program",
        default: null,
      },

      type: {
        type: String,
        enum: ["Percentage", "Fixed Amount", "Full"],
        default: "Fixed Amount",
      },

      value: { type: Number, default: 0, min: 0 },
      amount: { type: Number, default: 0, min: 0 },

      sponsor: { type: String, trim: true, default: "", maxlength: 180 },
      currency: { type: String, trim: true, uppercase: true, default: "UGX", maxlength: 8 },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },

      status: {
        type: String,
        enum: ["Active", "Inactive", "Expired", "Revoked"],
        default: "Active",
      },

      notes: { type: String, trim: true, default: "", maxlength: 4000 },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  ScholarshipSchema.pre("validate", function (next) {
    this.recordKind = this.studentId ? "Award" : "Program";
    if (this.type === "Full") this.value = 100;
    if (this.startDate && this.endDate && this.endDate < this.startDate) this.invalidate("endDate", "End date cannot be before start date.");
    next();
  });

  ScholarshipSchema.index({ name: 1 });
  ScholarshipSchema.index({ studentId: 1, status: 1 });
  ScholarshipSchema.index({ programId: 1 });
  ScholarshipSchema.index({ isDeleted: 1, createdAt: -1 });
  ScholarshipSchema.index(
    { sourceApplicationId: 1 },
    { name: "uniq_scholarship_source_application", unique: true, partialFilterExpression: { sourceApplicationId: { $type: "objectId" } } }
  );

  return conn.models.Scholarship || conn.model("Scholarship", ScholarshipSchema);
};
