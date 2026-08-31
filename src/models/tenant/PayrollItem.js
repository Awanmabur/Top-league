const mongoose = require("mongoose");

module.exports = function PayrollItemModel(conn) {
  if (!conn) throw new Error("PayrollItem model requires a DB connection");

  const PayrollItemSchema = new mongoose.Schema(
    {
      payrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollRun", required: true, index: true },
      staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true, index: true },
      departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },

      staffName: { type: String, trim: true, default: "", maxlength: 220 },
      employeeId: { type: String, trim: true, default: "", maxlength: 120 },
      payrollNumber: { type: String, trim: true, default: "", maxlength: 120 },
      departmentName: { type: String, trim: true, default: "", maxlength: 180 },

      basicSalary: { type: Number, default: 0, min: 0, max: 1000000000000000 },
      allowances: { type: Number, default: 0, min: 0, max: 1000000000000000 },
      bonuses: { type: Number, default: 0, min: 0, max: 1000000000000000 },
      deductions: { type: Number, default: 0, min: 0, max: 1000000000000000 },
      grossPay: { type: Number, default: 0, min: 0, max: 1000000000000000 },
      netPay: { type: Number, default: 0, min: 0, max: 1000000000000000 },

      status: { type: String, enum: ["Pending", "Processed", "Paid", "Held"], default: "Pending", index: true },
      processedAt: { type: Date, default: null },
      heldAt: { type: Date, default: null },
      heldReason: { type: String, trim: true, default: "", maxlength: 1000 },
      paidAt: { type: Date, default: null },
      paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      paymentReference: { type: String, trim: true, default: "", maxlength: 180 },

      notes: { type: String, trim: true, default: "", maxlength: 2000 },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  PayrollItemSchema.pre("validate", function (next) {
    const values = [this.basicSalary, this.allowances, this.bonuses, this.deductions].map((v) => Number(v || 0));
    if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1000000000000000)) return next(new Error("Payroll amount is invalid."));
    const [basicSalary, allowances, bonuses, deductions] = values;
    this.grossPay = basicSalary + allowances + bonuses;
    if (deductions > this.grossPay) return next(new Error("Deductions cannot exceed gross pay."));
    this.netPay = this.grossPay - deductions;
    next();
  });

  PayrollItemSchema.index(
    { payrollRunId: 1, staffId: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
  );
  PayrollItemSchema.index({ payrollRunId: 1, status: 1 });
  PayrollItemSchema.index({ staffId: 1, createdAt: -1 });
  PayrollItemSchema.index({ departmentId: 1, createdAt: -1 });
  PayrollItemSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.PayrollItem || conn.model("PayrollItem", PayrollItemSchema);
};
