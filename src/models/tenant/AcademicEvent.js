const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.AcademicEvent) return connection.models.AcademicEvent;

  const AcademicEventSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 160 },
      type: { type: String, required: true, trim: true, maxlength: 40, index: true },
      academicYear: { type: String, trim: true, maxlength: 20, default: "", index: true },
      term: { type: String, trim: true, maxlength: 40, default: "", index: true },
      classGroup: { type: Schema.Types.ObjectId, ref: "Class", default: null, index: true },
      className: { type: String, trim: true, maxlength: 180, default: "" },
      sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },
      sectionName: { type: String, trim: true, maxlength: 100, default: "" },
      sectionCode: { type: String, trim: true, maxlength: 40, default: "" },
      streamId: { type: Schema.Types.ObjectId, ref: "Stream", default: null, index: true },
      streamName: { type: String, trim: true, maxlength: 100, default: "" },
      streamCode: { type: String, trim: true, maxlength: 40, default: "" },
      startDateKey: { type: String, trim: true, maxlength: 10, default: "", index: true },
      endDateKey: { type: String, trim: true, maxlength: 10, default: "", index: true },
      startDate: { type: Date, required: true },
      endDate: { type: Date },
      location: { type: String, trim: true, maxlength: 120, default: "" },
      notes: { type: String, trim: true, maxlength: 1200, default: "" },
      status: { type: String, enum: ["active", "draft", "archived"], default: "draft", index: true },
      firstPublishedAt: { type: Date, default: null },
      publishedAt: { type: Date, default: null },
      publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      archivedAt: { type: Date, default: null },
      archivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      revision: { type: Number, default: 0, min: 0 },
      migrationQuarantinedAt: { type: Date, default: null, index: true },
      migrationQuarantineReason: { type: String, trim: true, maxlength: 500, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  AcademicEventSchema.index({ status: 1, startDateKey: 1, endDateKey: 1 });
  AcademicEventSchema.index({ academicYear: 1, term: 1, type: 1, startDateKey: 1 });
  AcademicEventSchema.index({ classGroup: 1, sectionId: 1, streamId: 1, status: 1, startDateKey: 1 });
  AcademicEventSchema.index({ title: 1 });
  return connection.model("AcademicEvent", AcademicEventSchema);
};
