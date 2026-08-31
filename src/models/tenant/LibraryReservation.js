const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryReservation) return connection.models.LibraryReservation;
  const schema = new Schema({
    reservationNo: { type: String, required: true, trim: true, maxlength: 80 },
    book: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentName: { type: String, trim: true, maxlength: 160, default: "" },
    regNo: { type: String, trim: true, maxlength: 80, default: "", index: true },
    bookTitle: { type: String, trim: true, maxlength: 300, default: "" },
    priority: { type: String, enum: ["Normal", "High"], default: "Normal" },
    status: { type: String, enum: ["Pending", "Approved", "Denied", "Fulfilled", "Cancelled"], default: "Pending", index: true },
    requestedAt: { type: Date, default: () => new Date(), index: true },
    decidedAt: { type: Date, default: null },
    fulfilledAt: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 1500, default: "" },
    legacyEmbeddedId: { type: String, trim: true, maxlength: 80, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });
  schema.pre("validate", function(next) {
    if (!this.student && this.studentId) this.student = this.studentId;
    if (!this.studentId && this.student) this.studentId = this.student;
    if (this.reservationNo) this.reservationNo = String(this.reservationNo).trim().toUpperCase();
    next();
  });
  schema.index({ reservationNo: 1 }, { unique: true });
  schema.index(
    { book: 1, student: 1, status: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, status: { $in: ["Pending", "Approved"] } } }
  );
  schema.index({ legacyEmbeddedId: 1 }, { unique: true, partialFilterExpression: { legacyEmbeddedId: { $gt: "" } } });
  return connection.model("LibraryReservation", schema);
};
