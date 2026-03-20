const mongoose = require("mongoose");

module.exports = function ExpenseModel(conn) {
  if (!conn) throw new Error("Expense model requires a DB connection");

  const ExpenseSchema = new mongoose.Schema(
    {
      expenseNumber: { type: String, trim: true, required: true },
      voucherNo: { type: String, trim: true, default: "" },
      reference: { type: String, trim: true, default: "" },

      title: { type: String, trim: true, required: true },
      description: { type: String, trim: true, default: "" },

      category: {
        type: String,
        enum: [
          "Salary",
          "Utilities",
          "Rent",
          "Stationery",
          "Transport",
          "Maintenance",
          "Procurement",
          "Allowance",
          "Other",
        ],
        default: "Other",
      },

      amount: { type: Number, required: true, min: 0 },
      expenseDate: { type: Date, default: Date.now },

      paidTo: { type: String, trim: true, default: "" },

      method: {
        type: String,
        enum: ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Transfer", "Other"],
        default: "Cash",
      },

      status: {
        type: String,
        enum: ["Draft", "Recorded", "Approved", "Rejected"],
        default: "Recorded",
      },

      notes: { type: String, trim: true, default: "" },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  ExpenseSchema.index({ expenseNumber: 1 }, { unique: true });
  ExpenseSchema.index({ expenseDate: -1, category: 1 });
  ExpenseSchema.index({ status: 1 });
  ExpenseSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Expense || conn.model("Expense", ExpenseSchema);
};