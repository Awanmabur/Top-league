const mongoose = require("mongoose");

module.exports = function PaymentModel(conn) {
  if (!conn) throw new Error("Payment model requires a DB connection");
  if (conn.models.Payment) return conn.models.Payment;

  const PaymentSchema = new mongoose.Schema(
    {
      receiptNumber: { type: String, trim: true, required: true, maxlength: 80 },
      reference: { type: String, trim: true, default: "", maxlength: 160 },

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

      amount: { type: Number, required: true, min: 0.01, max: 1e15 },
      // Portion of this payment actually applied to invoiceId. A completed
      // unallocated/account-credit payment has appliedAmount = 0.
      appliedAmount: { type: Number, default: 0, min: 0, max: 1e15 },

      method: {
        type: String,
        enum: ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Transfer", "Other"],
        default: "Cash",
      },

      status: {
        type: String,
        enum: ["Pending", "Completed", "Voided", "Refunded"],
        default: "Pending",
      },

      paymentDate: { type: Date, default: Date.now },
      completedAt: { type: Date, default: null },
      voidedAt: { type: Date, default: null },
      voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      voidReason: { type: String, trim: true, default: "", maxlength: 500 },
      refundedAt: { type: Date, default: null },
      refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      refundReason: { type: String, trim: true, default: "", maxlength: 500 },

      term: { type: String, trim: true, default: "", maxlength: 80 },
      academicYear: { type: String, trim: true, default: "", maxlength: 80 },
      notes: { type: String, trim: true, default: "", maxlength: 2000 },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  PaymentSchema.pre("validate", function (next) {
    if (this.status === "Completed" && !this.completedAt) this.completedAt = this.paymentDate || new Date();
    next();
  });

  PaymentSchema.index({ receiptNumber: 1 }, { unique: true });
  PaymentSchema.index({ studentId: 1, paymentDate: -1 });
  PaymentSchema.index({ invoiceId: 1, status: 1, isDeleted: 1 });
  PaymentSchema.index({ method: 1, status: 1 });
  PaymentSchema.index({ isDeleted: 1, createdAt: -1 });
  PaymentSchema.index({ isDeleted: 1, status: 1, paymentDate: -1 });
  PaymentSchema.index({ isDeleted: 1, method: 1, status: 1, paymentDate: -1 });

  return conn.model("Payment", PaymentSchema);
};
