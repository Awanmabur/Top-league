const mongoose = require("mongoose");

module.exports = function FinanceModel(conn) {
  if (!conn) throw new Error("Finance model requires a tenant connection");
  if (conn.models.Finance) return conn.models.Finance;

  const invoiceSchema = new mongoose.Schema(
    {
      invoiceNo: { type: String, trim: true, required: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      className: { type: String, trim: true, default: "" },
      term: { type: String, trim: true, default: "" },
      amount: { type: Number, min: 0, default: 0 },
      paidAmount: { type: Number, min: 0, default: 0 },
      balance: { type: Number, min: 0, default: 0 },
      dueDate: { type: Date, default: null },
      status: {
        type: String,
        enum: ["Pending", "Partially Paid", "Paid", "Overdue", "Cancelled"],
        default: "Pending",
      },
      note: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const paymentSchema = new mongoose.Schema(
    {
      receiptNo: { type: String, trim: true, required: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      invoiceNo: { type: String, trim: true, default: "" },
      amount: { type: Number, min: 0, default: 0 },
      method: {
        type: String,
        enum: ["Cash", "Bank", "Mobile Money", "Card", "Cheque", "Other"],
        default: "Cash",
      },
      date: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ["Completed", "Pending", "Reversed"],
        default: "Completed",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const feeStructureSchema = new mongoose.Schema(
    {
      className: { type: String, trim: true, required: true },
      term: { type: String, trim: true, required: true },
      tuition: { type: Number, min: 0, default: 0 },
      library: { type: Number, min: 0, default: 0 },
      hostel: { type: Number, min: 0, default: 0 },
      exam: { type: Number, min: 0, default: 0 },
      transport: { type: Number, min: 0, default: 0 },
      other: { type: Number, min: 0, default: 0 },
      total: { type: Number, min: 0, default: 0 },
      note: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const expenseSchema = new mongoose.Schema(
    {
      expenseNo: { type: String, trim: true, required: true },
      category: {
        type: String,
        enum: ["Utilities", "Supplies", "Maintenance", "Salary", "Transport", "Rent", "Other"],
        default: "Other",
      },
      title: { type: String, trim: true, required: true },
      amount: { type: Number, min: 0, default: 0 },
      vendor: { type: String, trim: true, default: "" },
      date: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ["Pending", "Approved", "Paid", "Rejected"],
        default: "Pending",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const payrollSummarySchema = new mongoose.Schema(
    {
      month: { type: String, trim: true, required: true },
      totalStaff: { type: Number, min: 0, default: 0 },
      grossPay: { type: Number, min: 0, default: 0 },
      deductions: { type: Number, min: 0, default: 0 },
      netPay: { type: Number, min: 0, default: 0 },
      status: {
        type: String,
        enum: ["Pending", "Processed", "Paid"],
        default: "Pending",
      },
      processedAt: { type: Date, default: null },
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
          "Invoice",
          "Payment",
          "Fee Structure",
          "Expense",
          "Payroll",
          "Status Changed",
        ],
        required: true,
      },
      actorName: { type: String, trim: true, default: "" },
      note: { type: String, trim: true, default: "" },
      date: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const financeSchema = new mongoose.Schema(
    {
      campusName: { type: String, trim: true, default: "" },

      invoices: [invoiceSchema],
      payments: [paymentSchema],
      feeStructures: [feeStructureSchema],
      expenses: [expenseSchema],
      payrollSummaries: [payrollSummarySchema],
      movements: [movementSchema],

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  return conn.model("Finance", financeSchema);
};