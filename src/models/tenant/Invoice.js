const mongoose = require("mongoose");

module.exports = function InvoiceModel(conn) {
  if (!conn) throw new Error("Invoice model requires a DB connection");

  const InvoiceSchema = new mongoose.Schema(
    {
      invoiceNumber: { type: String, trim: true, required: true },
      reference: { type: String, trim: true, default: "" },

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

      term: { type: String, trim: true, default: "" },
      academicYear: { type: String, trim: true, default: "" },

      items: [
        {
          title: { type: String, trim: true, required: true },
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
          qty: { type: Number, default: 1, min: 1 },
          unitAmount: { type: Number, default: 0, min: 0 },
          amount: { type: Number, default: 0, min: 0 },
          note: { type: String, trim: true, default: "" },
        },
      ],

      subtotal: { type: Number, default: 0, min: 0 },
      discountAmount: { type: Number, default: 0, min: 0 },
      taxAmount: { type: Number, default: 0, min: 0 },
      totalAmount: { type: Number, default: 0, min: 0 },

      paidAmount: { type: Number, default: 0, min: 0 },
      balance: { type: Number, default: 0, min: 0 },

      currency: { type: String, trim: true, default: "UGX" },

      status: {
        type: String,
        enum: ["Draft", "Unpaid", "Partially Paid", "Paid", "Overdue", "Cancelled"],
        default: "Unpaid",
      },

      issueDate: { type: Date, default: Date.now },
      dueDate: { type: Date, default: null },

      notes: { type: String, trim: true, default: "" },

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
          const qty = Number(item.qty || 0);
          const unit = Number(item.unitAmount || 0);
          item.amount = Number(item.amount || qty * unit || 0);
          return sum + Number(item.amount || 0);
        }, 0)
      : 0;

    this.subtotal = subtotal;
    this.totalAmount = Math.max(
      0,
      Number(this.subtotal || 0) - Number(this.discountAmount || 0) + Number(this.taxAmount || 0)
    );
    this.balance = Math.max(0, Number(this.totalAmount || 0) - Number(this.paidAmount || 0));

    if (this.status !== "Cancelled" && this.status !== "Draft") {
      if (this.balance <= 0 && this.totalAmount > 0) this.status = "Paid";
      else if (this.paidAmount > 0 && this.balance > 0) this.status = "Partially Paid";
      else this.status = "Unpaid";
    }

    next();
  });

  InvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
  InvoiceSchema.index({ studentId: 1, createdAt: -1 });
  InvoiceSchema.index({ status: 1, dueDate: 1 });
  InvoiceSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Invoice || conn.model("Invoice", InvoiceSchema);
};