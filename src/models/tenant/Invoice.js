const mongoose = require("mongoose");
const { deriveInvoiceStatus } = require("../../services/tenant/financeService");

module.exports = function InvoiceModel(conn) {
  if (!conn) throw new Error("Invoice model requires a DB connection");
  if (conn.models.Invoice) return conn.models.Invoice;

  const InvoiceSchema = new mongoose.Schema(
    {
      invoiceNumber: { type: String, trim: true, required: true, maxlength: 80 },
      reference: { type: String, trim: true, default: "", maxlength: 160 },

      studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
        required: true,
      },

      programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Program",
        default: null,
      },

      feeStructureId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FeeStructure",
        default: null,
        index: true,
      },

      term: { type: String, trim: true, default: "", maxlength: 80 },
      academicYear: { type: String, trim: true, default: "", maxlength: 80 },

      items: [
        {
          title: { type: String, trim: true, required: true, maxlength: 160 },
          category: {
            type: String,
            enum: [
              "Tuition",
              "Registration",
              "Library",
              "Hostel",
              "Examination",
              "Transport",
              "Other",
            ],
            default: "Tuition",
          },
          qty: { type: Number, default: 1, min: 1, max: 100000 },
          unitAmount: { type: Number, default: 0, min: 0, max: 1e15 },
          amount: { type: Number, default: 0, min: 0, max: 1e18 },
          note: { type: String, trim: true, default: "", maxlength: 500 },
        },
      ],

      subtotal: { type: Number, default: 0, min: 0 },
      discountAmount: { type: Number, default: 0, min: 0 },
      taxAmount: { type: Number, default: 0, min: 0 },
      totalAmount: { type: Number, default: 0, min: 0 },

      paidAmount: { type: Number, default: 0, min: 0 },
      balance: { type: Number, default: 0, min: 0 },

      currency: { type: String, trim: true, default: "UGX", uppercase: true, maxlength: 8 },

      status: {
        type: String,
        enum: ["Draft", "Unpaid", "Partially Paid", "Paid", "Overdue", "Cancelled"],
        default: "Unpaid",
      },

      issueDate: { type: Date, default: Date.now },
      dueDate: { type: Date, default: null },

      notes: { type: String, trim: true, default: "", maxlength: 2000 },

      cancelledAt: { type: Date, default: null },
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      cancelReason: { type: String, trim: true, default: "", maxlength: 500 },

      // Short-lived application lease used to serialize payment mutations for
      // this invoice when Mongo transactions are unavailable.
      paymentLeaseToken: { type: String, trim: true, default: "", select: false },
      paymentLeaseExpiresAt: { type: Date, default: null, select: false },
      paymentLeaseBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, select: false },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  InvoiceSchema.pre("validate", function (next) {
    const subtotal = Array.isArray(this.items)
      ? this.items.reduce((sum, item) => {
          const qty = Math.max(1, Number(item.qty || 1));
          const unit = Math.max(0, Number(item.unitAmount || 0));
          item.amount = qty * unit;
          return sum + item.amount;
        }, 0)
      : 0;

    this.subtotal = subtotal;
    this.discountAmount = Math.min(subtotal, Math.max(0, Number(this.discountAmount || 0)));
    this.taxAmount = Math.max(0, Number(this.taxAmount || 0));
    this.totalAmount = Math.max(0, this.subtotal - this.discountAmount + this.taxAmount);
    this.paidAmount = Math.max(0, Math.min(Number(this.paidAmount || 0), this.totalAmount));
    this.balance = Math.max(0, this.totalAmount - this.paidAmount);
    this.status = deriveInvoiceStatus({
      totalAmount: this.totalAmount,
      paidAmount: this.paidAmount,
      dueDate: this.dueDate,
      status: this.status,
    });

    next();
  });

  InvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
  InvoiceSchema.index({ studentId: 1, createdAt: -1 });
  InvoiceSchema.index({ status: 1, dueDate: 1 });
  InvoiceSchema.index({ isDeleted: 1, createdAt: -1 });
  InvoiceSchema.index({ isDeleted: 1, status: 1, balance: 1, studentId: 1 });
  InvoiceSchema.index({ paymentLeaseExpiresAt: 1 });

  return conn.model("Invoice", InvoiceSchema);
};
