const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Assignment) return connection.models.Assignment;

  const AssignmentSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 200 },

      // Subject link
      course: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
      // optional denormalized display (useful if subject gets renamed later)
      courseName: { type: String, trim: true, maxlength: 160 },

      classGroup: { type: Schema.Types.ObjectId, ref: "Class", default: null, index: true },
      className: { type: String, trim: true, maxlength: 180, default: "" },
      sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },
      sectionName: { type: String, trim: true, maxlength: 100, default: "" },
      sectionCode: { type: String, trim: true, maxlength: 40, default: "" },
      streamId: { type: Schema.Types.ObjectId, ref: "Stream", default: null, index: true },
      streamName: { type: String, trim: true, maxlength: 100, default: "" },
      streamCode: { type: String, trim: true, maxlength: 40, default: "" },

      // Dates & grading
      academicYear: { type: String, trim: true, maxlength: 20, default: "", index: true },
      term: { type: Number, min: 1, max: 3, default: null, index: true },
      dueDate: { type: Date, default: null, index: true },
      totalPoints: { type: Number, min: 0, max: 1000, default: 100 },
      allowLateSubmissions: { type: Boolean, default: false },

      // Content
      instructions: { type: String, trim: true, maxlength: 4000 },
      rubric: { type: String, trim: true, maxlength: 4000 },

      // For now: URLs or filenames
      attachments: [{ type: String, trim: true, maxlength: 500 }],

      // Workflow
      status: {
        type: String,
        enum: ["draft", "published", "closed", "archived"],
        default: "draft",
        index: true,
      },

      publishedAt: { type: Date, default: null },
      publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      closedAt: { type: Date, default: null },
      closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      archivedAt: { type: Date, default: null },
      archivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      revision: { type: Number, default: 0, min: 0 },
      migrationQuarantinedAt: { type: Date, default: null, index: true },
      migrationQuarantineReason: { type: String, trim: true, maxlength: 500, default: "" },

      // Soft delete / audit
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
      deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  AssignmentSchema.index({ title: 1 });
  AssignmentSchema.index({ course: 1, status: 1, dueDate: 1 });
  AssignmentSchema.index({ classGroup: 1, sectionId: 1, streamId: 1, academicYear: 1, term: 1, status: 1, dueDate: 1 });

  AssignmentSchema.pre("save", function (next) {
    if (this.title) this.title = String(this.title).trim().replace(/\s+/g, " ");
    if (this.courseName) this.courseName = String(this.courseName).trim().replace(/\s+/g, " ");
    next();
  });

  AssignmentSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("Assignment", AssignmentSchema);
};
