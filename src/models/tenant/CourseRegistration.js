const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("CourseRegistration model requires a mongoose connection");
  if (connection.models.CourseRegistration) return connection.models.CourseRegistration;

  const HistorySchema = new Schema({
    action: { type: String, required: true, trim: true, maxlength: 40 },
    fromStatus: { type: String, default: "", trim: true, maxlength: 20 },
    toStatus: { type: String, default: "", trim: true, maxlength: 20 },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    at: { type: Date, default: Date.now },
  }, { _id: false });

  const CourseRegistrationSchema = new Schema({
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    academicYear: { type: String, required: true, trim: true, maxlength: 20, index: true },
    term: { type: Number, required: true, min: 1, max: 3, index: true },
    status: { type: String, enum: ["pending", "approved", "rejected", "dropped"], default: "pending", index: true },
    subjectCode: { type: String, default: "", trim: true, uppercase: true, maxlength: 40 },
    subjectTitle: { type: String, default: "", trim: true, maxlength: 180 },
    weeklyPeriods: { type: Number, default: 0, min: 0, max: 50 },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decisionNote: { type: String, default: "", trim: true, maxlength: 500 },
    droppedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
    history: { type: [HistorySchema], default: [] },
    legacySourceId: { type: String, default: "", trim: true, maxlength: 180 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });

  CourseRegistrationSchema.index(
    { studentId: 1, subjectId: 1, academicYear: 1, term: 1 },
    { unique: true, name: "uniq_student_subject_period" }
  );
  CourseRegistrationSchema.index({ studentId: 1, academicYear: 1, term: 1, status: 1, isDeleted: 1 });
  CourseRegistrationSchema.index({ subjectId: 1, academicYear: 1, term: 1, status: 1, isDeleted: 1 });
  CourseRegistrationSchema.index({ legacySourceId: 1 }, { unique: true, sparse: true });

  return connection.model("CourseRegistration", CourseRegistrationSchema);
};
