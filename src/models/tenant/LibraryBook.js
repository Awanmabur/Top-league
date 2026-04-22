const mongoose = require("mongoose");

module.exports = function LibraryBookModel(conn) {
  if (!conn) throw new Error("LibraryBook model requires a tenant connection");
  if (conn.models.LibraryBook) return conn.models.LibraryBook;

  const borrowSchema = new mongoose.Schema(
    {
      loanId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      bookTitle: { type: String, trim: true, required: true },
      copyId: { type: String, trim: true, default: "" },
      borrowedAt: { type: Date, default: Date.now },
      dueDate: { type: Date, default: null },
      returnedAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["Borrowed", "Returned", "Overdue"],
        default: "Borrowed",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const reservationSchema = new mongoose.Schema(
    {
      reservationId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      requestedAt: { type: Date, default: Date.now },
      priority: {
        type: String,
        enum: ["Normal", "High"],
        default: "Normal",
      },
      status: {
        type: String,
        enum: ["Pending", "Approved", "Denied", "Fulfilled"],
        default: "Pending",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const fineSchema = new mongoose.Schema(
    {
      fineId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      reason: { type: String, trim: true, required: true },
      amount: { type: Number, min: 0, default: 0 },
      status: {
        type: String,
        enum: ["Pending", "Paid", "Waived"],
        default: "Pending",
      },
      createdAt: { type: Date, default: Date.now },
      paidAt: { type: Date, default: null },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const holdSchema = new mongoose.Schema(
    {
      holdId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      type: {
        type: String,
        enum: ["Library Hold", "Clearance Hold", "Borrowing Hold"],
        default: "Library Hold",
      },
      reason: { type: String, trim: true, required: true },
      since: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ["Active Hold", "Released"],
        default: "Active Hold",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const movementSchema = new mongoose.Schema(
    {
      type: {
        type: String,
        enum: [
          "Created",
          "Updated",
          "Borrowed",
          "Returned",
          "Reserved",
          "Fine Added",
          "Hold Added",
          "Status Changed",
          "Copy Added",
        ],
        required: true,
      },
      actorName: { type: String, trim: true, default: "" },
      note: { type: String, trim: true, default: "" },
      date: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const libraryBookSchema = new mongoose.Schema(
    {
      bookId: { type: String, trim: true, index: true },
      title: { type: String, trim: true, required: true, index: true },
      author: { type: String, trim: true, required: true, index: true },
      isbn: { type: String, trim: true, required: true },
      category: {
        type: String,
        enum: ["Computer Science", "Mathematics", "Business", "Literature", "Other"],
        default: "Other",
        index: true,
      },
      publisher: { type: String, trim: true, default: "" },
      year: { type: Number, min: 0, default: null },
      copies: { type: Number, min: 0, default: 1 },
      available: { type: Number, min: 0, default: 1 },
      status: {
        type: String,
        enum: ["Available", "Borrowed", "Reserved", "Damaged"],
        default: "Available",
        index: true,
      },
      shelf: { type: String, trim: true, default: "" },
      notes: { type: String, trim: true, default: "" },

      borrows: [borrowSchema],
      reservations: [reservationSchema],
      fines: [fineSchema],
      holds: [holdSchema],
      movements: [movementSchema],

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  libraryBookSchema.index({ isbn: 1 }, { unique: true });

  return conn.model("LibraryBook", libraryBookSchema);
};
