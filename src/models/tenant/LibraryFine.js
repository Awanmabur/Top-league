const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryFine) return connection.models.LibraryFine;
  const schema = new Schema({
    fineNo: { type: String, required: true, trim: true, maxlength: 80 },
    book: { type: Schema.Types.ObjectId, ref: "LibraryBook", default: null, index: true },
    loan: { type: Schema.Types.ObjectId, ref: "LibraryLoan", default: null },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentName: { type: String, trim: true, maxlength: 160, default: "" },
    regNo: { type: String, trim: true, maxlength: 80, default: "", index: true },
    bookTitle: { type: String, trim: true, maxlength: 300, default: "" },
    reason: { type: String, trim: true, maxlength: 1000, required: true },
    amount: { type: Number, min: 0, required: true },
    status: { type: String, enum: ["Pending", "Paid", "Waived"], default: "Pending", index: true },
    createdAtRecord: { type: Date, default: () => new Date(), index: true },
    paidAt: { type: Date, default: null },
    waivedAt: { type: Date, default: null },
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
    if (this.fineNo) this.fineNo = String(this.fineNo).trim().toUpperCase();
    next();
  });
  schema.index({ fineNo: 1 }, { unique: true });
  schema.index({ student: 1, status: 1, createdAtRecord: -1 });
  schema.index({ loan: 1 }, { name: "uniq_active_library_fine_loan", unique: true, partialFilterExpression: { loan: { $type: "objectId" }, isDeleted: false } });
  schema.index({ legacyEmbeddedId: 1 }, { unique: true, partialFilterExpression: { legacyEmbeddedId: { $gt: "" } } });
  return connection.model("LibraryFine", schema);
};
