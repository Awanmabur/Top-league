const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("LetterRequest model requires a mongoose connection");
  if (connection.models.LetterRequest) return connection.models.LetterRequest;

  const HistorySchema = new Schema({
    fromStatus: { type: String, default: "", trim: true, maxlength: 30 },
    toStatus: { type: String, required: true, trim: true, maxlength: 30 },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    at: { type: Date, default: Date.now },
  }, { _id: false });

  const LetterRequestSchema = new Schema({
    requestNumber: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 80, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    type: { type: String, enum: ["Admission Letter", "Registration Letter", "Bonafide Student Letter", "Study Load Confirmation"], required: true, index: true },
    purpose: { type: String, default: "", trim: true, maxlength: 1000 },
    academicYear: { type: String, required: true, trim: true, maxlength: 20, index: true },
    term: { type: Number, required: true, min: 1, max: 3, index: true },
    status: { type: String, enum: ["Pending", "Approved", "Rejected", "Ready", "Collected", "Cancelled"], default: "Pending", index: true },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewNote: { type: String, default: "", trim: true, maxlength: 500 },
    readyAt: { type: Date, default: null },
    issuedSnapshot: {
      studentName: { type: String, default: "", trim: true, maxlength: 220 },
      registrationNumber: { type: String, default: "", trim: true, maxlength: 100 },
      classLevel: { type: String, default: "", trim: true, maxlength: 40 },
      academicYear: { type: String, default: "", trim: true, maxlength: 20 },
      term: { type: Number, default: null, min: 1, max: 3 },
      purpose: { type: String, default: "", trim: true, maxlength: 1000 },
    },
    collectedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
    legacySourceId: { type: String, default: "", trim: true, maxlength: 180 },
    history: { type: [HistorySchema], default: [] },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  }, { timestamps: true });

  LetterRequestSchema.index({ studentId: 1, academicYear: 1, term: 1, status: 1, isDeleted: 1 });
  LetterRequestSchema.index({ type: 1, status: 1, createdAt: -1, isDeleted: 1 });
  LetterRequestSchema.index({ legacySourceId: 1 }, { unique: true, sparse: true });
  return connection.model("LetterRequest", LetterRequestSchema);
};
