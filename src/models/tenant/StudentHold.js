const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("StudentHold model requires a mongoose connection");
  if (connection.models.StudentHold) return connection.models.StudentHold;

  const StudentHoldSchema = new Schema({
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    type: { type: String, enum: ["academic", "finance", "discipline", "documents", "other"], default: "other", index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    blocksSubjectRegistration: { type: Boolean, default: true, index: true },
    status: { type: String, enum: ["active", "cleared"], default: "active", index: true },
    expiresAt: { type: Date, default: null, index: true },
    clearedAt: { type: Date, default: null },
    clearedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    revision: { type: Number, default: 1, min: 1 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });

  StudentHoldSchema.index({ studentId: 1, status: 1, blocksSubjectRegistration: 1, expiresAt: 1, isDeleted: 1 });
  return connection.model("StudentHold", StudentHoldSchema);
};
