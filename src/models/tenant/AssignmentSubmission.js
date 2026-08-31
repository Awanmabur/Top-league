const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("AssignmentSubmission model requires a mongoose connection");
  if (connection.models.AssignmentSubmission) return connection.models.AssignmentSubmission;

  const AssignmentSubmissionSchema = new Schema(
    {
      assignment: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      text: { type: String, trim: true, maxlength: 12000, default: "" },
      attachmentUrls: [{ type: String, trim: true, maxlength: 500 }],
      status: { type: String, enum: ["draft", "submitted", "graded"], default: "draft", index: true },
      submittedAt: { type: Date, default: null, index: true },
      lastSubmittedAt: { type: Date, default: null },
      submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      withdrawnAt: { type: Date, default: null },
      withdrawnBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      isLate: { type: Boolean, default: false, index: true },
      revision: { type: Number, default: 0, min: 0 },
      score: { type: Number, default: null, min: 0 },
      percentage: { type: Number, default: null, min: 0, max: 100 },
      feedback: { type: String, trim: true, maxlength: 4000, default: "" },
      gradedAt: { type: Date, default: null, index: true },
      gradedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      gradeRevision: { type: Number, default: 0, min: 0 },
      reopenedAt: { type: Date, default: null },
      reopenedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      migrationQuarantinedAt: { type: Date, default: null, index: true },
      migrationQuarantineReason: { type: String, trim: true, maxlength: 500, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  AssignmentSubmissionSchema.index(
    { assignment: 1, student: 1 },
    {
      unique: true,
      name: "uniq_active_assignment_student_submission",
      partialFilterExpression: { migrationQuarantinedAt: null },
    }
  );
  AssignmentSubmissionSchema.index({ student: 1, status: 1, submittedAt: -1 });
  AssignmentSubmissionSchema.index({ assignment: 1, status: 1, submittedAt: 1 });

  return connection.model("AssignmentSubmission", AssignmentSubmissionSchema);
};
