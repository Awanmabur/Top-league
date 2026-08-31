const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryLoan) return connection.models.LibraryLoan;
  const schema = new Schema({
    loanNo: { type: String, required: true, trim: true, maxlength: 80 },
    book: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true, index: true },
    borrowerType: { type: String, enum: ["student", "staff"], default: "student", required: true, index: true },
    borrowerId: { type: Schema.Types.ObjectId, required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", default: null, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", default: null, index: true },
    borrowerName: { type: String, trim: true, maxlength: 160, default: "" },
    regNo: { type: String, trim: true, maxlength: 80, default: "", index: true },
    bookTitle: { type: String, trim: true, maxlength: 300, default: "" },
    copyId: { type: String, trim: true, maxlength: 80, default: "" },
    issuedAt: { type: Date, default: () => new Date(), index: true },
    dueAt: { type: Date, required: true, index: true },
    returnedAt: { type: Date, default: null },
    status: { type: String, enum: ["issued", "returned", "overdue"], default: "issued", index: true },
    renewalCount: { type: Number, min: 0, default: 0 },
    lastRenewedAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    legacyEmbeddedId: { type: String, trim: true, maxlength: 80, default: "" },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });
  schema.pre("validate", function(next) {
    if (this.borrowerType === "student") {
      if (!this.student && this.studentId) this.student = this.studentId;
      if (!this.studentId && this.student) this.studentId = this.student;
      if (!this.borrowerId) this.borrowerId = this.student || this.studentId;
    }
    if (this.loanNo) this.loanNo = String(this.loanNo).trim().toUpperCase();
    next();
  });
  schema.index({ loanNo: 1 }, { unique: true });
  schema.index(
    { book: 1, borrowerType: 1, borrowerId: 1, status: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, status: { $in: ["issued", "overdue"] } } }
  );
  schema.index({ student: 1, status: 1, dueAt: 1 });
  schema.index({ legacyEmbeddedId: 1 }, { unique: true, partialFilterExpression: { legacyEmbeddedId: { $gt: "" } } });
  return connection.model("LibraryLoan", schema);
};
