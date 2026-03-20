const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryLoan) return connection.models.LibraryLoan;

  const LibraryLoanSchema = new Schema(
    {
      book: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true, index: true },

      borrowerType: { type: String, enum: ["student", "staff"], required: true, index: true },
      borrowerId: { type: Schema.Types.ObjectId, required: true, index: true },

      issuedAt: { type: Date, default: () => new Date(), index: true },
      dueAt: { type: Date, required: true },
      returnedAt: { type: Date, default: null },

      status: { type: String, enum: ["issued", "returned"], default: "issued", index: true },
      notes: { type: String, trim: true, maxlength: 300 },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  // only one active loan for same book per borrower at a time
  LibraryLoanSchema.index(
    { book: 1, borrowerType: 1, borrowerId: 1, status: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true }, status: "issued" } }
  );

  LibraryLoanSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("LibraryLoan", LibraryLoanSchema);
};
