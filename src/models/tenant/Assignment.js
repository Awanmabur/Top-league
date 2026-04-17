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

      // Dates & grading
      dueDate: { type: Date, default: null, index: true },
      totalPoints: { type: Number, min: 0, max: 1000, default: 100 },

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

      // Soft delete / audit
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  AssignmentSchema.index({ title: 1 });
  AssignmentSchema.index({ course: 1, status: 1, dueDate: 1 });

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
