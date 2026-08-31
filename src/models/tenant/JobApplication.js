const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("JobApplication model requires a mongoose connection");
  if (connection.models.JobApplication) return connection.models.JobApplication;

  const HistorySchema = new Schema({
    fromStatus: { type: String, default: "", trim: true, maxlength: 30 },
    toStatus: { type: String, required: true, trim: true, maxlength: 30 },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    at: { type: Date, default: Date.now },
  }, { _id: false });

  const JobApplicationSchema = new Schema({
    jobId: { type: Schema.Types.ObjectId, ref: "JobOpportunity", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    coverNote: { type: String, default: "", trim: true, maxlength: 2000 },
    status: { type: String, enum: ["Submitted", "Reviewing", "Shortlisted", "Interview", "Accepted", "Rejected", "Withdrawn"], default: "Submitted", index: true },
    submittedAt: { type: Date, default: Date.now },
    withdrawnAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    revision: { type: Number, default: 1, min: 1 },
    legacySourceId: { type: String, default: "", trim: true, maxlength: 180 },
    history: { type: [HistorySchema], default: [] },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  }, { timestamps: true });

  JobApplicationSchema.index({ jobId: 1, studentId: 1 }, { unique: true, name: "uniq_job_student" });
  JobApplicationSchema.index({ studentId: 1, status: 1, isDeleted: 1, createdAt: -1 });
  JobApplicationSchema.index({ jobId: 1, status: 1, isDeleted: 1, createdAt: -1 });
  JobApplicationSchema.index({ legacySourceId: 1 }, { unique: true, sparse: true });
  return connection.model("JobApplication", JobApplicationSchema);
};
