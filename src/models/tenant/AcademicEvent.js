const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.AcademicEvent) return connection.models.AcademicEvent;

  const AcademicEventSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 160 },
      type: { type: String, required: true, trim: true, maxlength: 40 }, // "Semester", "Exam", etc.

      academicYear: { type: String, trim: true, maxlength: 20 }, // "2025/2026"
      term: { type: String, trim: true, maxlength: 40 },         // "Semester 1"

      startDate: { type: Date, required: true },
      endDate: { type: Date },

      location: { type: String, trim: true, maxlength: 120 },
      notes: { type: String, trim: true, maxlength: 1200 },

      status: { type: String, enum: ["active", "draft", "archived"], default: "draft", index: true },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
    },
    { timestamps: true }
  );

  AcademicEventSchema.index({ academicYear: 1, term: 1, type: 1, startDate: 1 });
  AcademicEventSchema.index({ title: 1 });

  return connection.model("AcademicEvent", AcademicEventSchema);
};
