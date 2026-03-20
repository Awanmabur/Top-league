const mongoose = require("mongoose");

module.exports = function PaymentModel(conn) {
  if (!conn) throw new Error("Payment model requires a DB connection");

  const PaymentSchema = new mongoose.Schema(
    {
      receiptNumber: { type: String, trim: true, required: true },
      reference: { type: String, trim: true, default: "" },

      studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true,
      },

      invoiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Invoice",
        default: null,
      },

      programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Program",
        default: null,
      },

      amount: { type: Number, required: true, min: 0 },

      method: {
        type: String,
        enum: ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Transfer", "Other"],
        default: "Cash",
      },

      status: {
        type: String,
        enum: ["Pending", "Completed", "Voided", "Refunded"],
        default: "Completed",
      },

      paymentDate: { type: Date, default: Date.now },
      term: { type: String, trim: true, default: "" },
      academicYear: { type: String, trim: true, default: "" },
      notes: { type: String, trim: true, default: "" },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  PaymentSchema.index({ receiptNumber: 1 }, { unique: true });
  PaymentSchema.index({ studentId: 1, paymentDate: -1 });
  PaymentSchema.index({ invoiceId: 1 });
  PaymentSchema.index({ method: 1, status: 1 });
  PaymentSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Payment || conn.model("Payment", PaymentSchema);
};