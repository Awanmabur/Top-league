const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryHold) return connection.models.LibraryHold;
  const schema = new Schema({
    holdNo: { type: String, required: true, trim: true, maxlength: 80 },
    book: { type: Schema.Types.ObjectId, ref: "LibraryBook", default: null, index: true },
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentName: { type: String, trim: true, maxlength: 160, default: "" },
    regNo: { type: String, trim: true, maxlength: 80, default: "", index: true },
    bookTitle: { type: String, trim: true, maxlength: 300, default: "" },
    type: { type: String, enum: ["Library Hold", "Clearance Hold", "Borrowing Hold"], default: "Library Hold" },
    reason: { type: String, trim: true, maxlength: 1000, required: true },
    since: { type: Date, default: () => new Date(), index: true },
    status: { type: String, enum: ["Active Hold", "Released"], default: "Active Hold", index: true },
    releasedAt: { type: Date, default: null },
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
    if (this.holdNo) this.holdNo = String(this.holdNo).trim().toUpperCase();
    next();
  });
  schema.index({ holdNo: 1 }, { unique: true });
  schema.index({ student: 1, status: 1, since: -1 });
  schema.index(
    { student: 1, type: 1, status: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, status: "Active Hold" } }
  );
  schema.index({ legacyEmbeddedId: 1 }, { unique: true, partialFilterExpression: { legacyEmbeddedId: { $gt: "" } } });
  return connection.model("LibraryHold", schema);
};
