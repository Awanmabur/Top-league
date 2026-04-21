const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PromotionLog) return connection.models.PromotionLog;

  const PromotionLogSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },

      fromAcademicYear: { type: String, trim: true, maxlength: 20 },
      toAcademicYear: { type: String, trim: true, maxlength: 20 },

      fromSemester: { type: Number, min: 1, max: 6 },
      toSemester: { type: Number, min: 1, max: 6 },
      fromTerm: { type: Number, min: 1, max: 3 },
      toTerm: { type: Number, min: 1, max: 3 },

      fromYearLevel: { type: String, trim: true, maxlength: 30 },
      toYearLevel: { type: String, trim: true, maxlength: 30 },
      fromSchoolLevel: { type: String, trim: true, maxlength: 30 },
      toSchoolLevel: { type: String, trim: true, maxlength: 30 },
      fromClassLevel: { type: String, trim: true, maxlength: 30 },
      toClassLevel: { type: String, trim: true, maxlength: 30 },

      fromClassGroup: { type: Schema.Types.ObjectId, ref: "Class", default: null },
      toClassGroup: { type: Schema.Types.ObjectId, ref: "Class", default: null },
      fromClassId: { type: String, trim: true, maxlength: 80 },
      toClassId: { type: String, trim: true, maxlength: 80 },
      fromSection: { type: String, trim: true, maxlength: 80 },
      toSection: { type: String, trim: true, maxlength: 80 },
      fromStatus: { type: String, trim: true, maxlength: 40 },
      toStatus: { type: String, trim: true, maxlength: 40 },

      reason: { type: String, trim: true, maxlength: 300 },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  PromotionLogSchema.index({ createdAt: -1 });

  return connection.model("PromotionLog", PromotionLogSchema);
};
