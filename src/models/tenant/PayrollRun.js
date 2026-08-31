const mongoose = require("mongoose");

module.exports = function PayrollRunModel(conn) {
  if (!conn) throw new Error("PayrollRun model requires a DB connection");

  const PayrollRunSchema = new mongoose.Schema(
    {
      runNumber: { type: String, trim: true, required: true, maxlength: 64 },
      scopeKey: { type: String, trim: true, required: true, maxlength: 160 },
      title: { type: String, required: true, trim: true, maxlength: 180 },
      periodLabel: { type: String, trim: true, default: "", maxlength: 120 },
      month: {
        type: String,
        required: true,
        trim: true,
        enum: ["January","February","March","April","May","June","July","August","September","October","November","December"],
      },
      year: { type: Number, required: true, min: 2000, max: 3000 },
      departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
      payDate: { type: Date, default: null },
      status: { type: String, enum: ["Draft", "Processed", "Approved", "Closed"], default: "Draft", index: true },
      staffCount: { type: Number, default: 0, min: 0 },
      grossAmount: { type: Number, default: 0, min: 0 },
      deductionsAmount: { type: Number, default: 0, min: 0 },
      netAmount: { type: Number, default: 0, min: 0 },
      notes: { type: String, trim: true, default: "", maxlength: 3000 },

      processedAt: { type: Date, default: null },
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      approvedAt: { type: Date, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      paidAt: { type: Date, default: null },
      paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      closedAt: { type: Date, default: null },
      closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      expenseId: { type: mongoose.Schema.Types.ObjectId, ref: "Expense", default: null },

      ops: {
        lockToken: { type: String, default: null, select: false },
        lockUntil: { type: Date, default: null, select: false },
      },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  PayrollRunSchema.index({ runNumber: 1 }, { unique: true });
  PayrollRunSchema.index(
    { scopeKey: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
  );
  PayrollRunSchema.index({ year: -1, month: 1, status: 1 });
  PayrollRunSchema.index({ departmentId: 1, year: -1, month: 1 });
  PayrollRunSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.PayrollRun || conn.model("PayrollRun", PayrollRunSchema);
};
