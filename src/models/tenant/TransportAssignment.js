const { Schema } = require("mongoose");
module.exports = (connection) => {
  if (!connection) throw new Error("TransportAssignment model requires a mongoose connection");
  if (connection.models.TransportAssignment) return connection.models.TransportAssignment;
  const schema = new Schema({
    assignmentCode: { type: String, required: true, trim: true, maxlength: 40 },
    route: { type: Schema.Types.ObjectId, ref: "Transport", required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    studentRegNo: { type: String, default: "", trim: true, maxlength: 60 },
    studentName: { type: String, default: "", trim: true, maxlength: 160 },
    pickupPoint: { type: String, required: true, trim: true, maxlength: 120 },
    feeAmountSnapshot: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["active", "ended"], default: "active", index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    endedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
    migrationQuarantinedAt: { type: Date, default: null, index: true },
    migrationQuarantineReason: { type: String, default: "", trim: true, maxlength: 500 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });
  schema.index({ assignmentCode: 1 }, { unique: true });
  schema.index({ student: 1, status: 1, isDeleted: 1 });
  schema.index({ route: 1, status: 1, isDeleted: 1 });
  schema.index(
    { student: 1 },
    { name: "uniq_active_transport_assignment_student", unique: true, partialFilterExpression: { status: "active", isDeleted: false, migrationQuarantinedAt: null } }
  );
  return connection.model("TransportAssignment", schema);
};
