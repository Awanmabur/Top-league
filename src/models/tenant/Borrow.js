const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Borrow) return connection.models.Borrow;

  const BorrowSchema = new Schema(
    {
      bookId: { type: Schema.Types.ObjectId, ref: "LibraryBook", required: true },
      studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },

      borrowDate: { type: Date, required: true, default: Date.now },
      dueDate: { type: Date, required: true },
      returnDate: { type: Date, default: null },

      status: {
        type: String,
        enum: ["borrowed", "returned", "overdue", "lost"],
        default: "borrowed"
      },

      // If penalties apply later
      penaltyAmount: { type: Number, default: 0 },
      penaltyStatus: { type: String, enum: ["none", "pending", "paid"], default: "none" },

      issuedBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
      receivedBy: { type: Schema.Types.ObjectId, ref: "Staff", default: null }
    },
    { timestamps: true }
  );

  BorrowSchema.index({ studentId: 1, bookId: 1, status: 1 });

  return connection.model("Borrow", BorrowSchema);
};
