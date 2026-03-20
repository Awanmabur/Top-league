const mongoose = require("mongoose");

module.exports = function PayrollItemModel(conn) {
  if (!conn) throw new Error("PayrollItem model requires a DB connection");

  const PayrollItemSchema = new mongoose.Schema(
    {
      payrollRunId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PayrollRun",
        required: true,
        index: true,
      },

      staffId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Staff",
        required: true,
        index: true,
      },

      departmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        default: null,
        index: true,
      },

      basicSalary: {
        type: Number,
        default: 0,
        min: 0,
      },

      allowances: {
        type: Number,
        default: 0,
        min: 0,
      },

      bonuses: {
        type: Number,
        default: 0,
        min: 0,
      },

      deductions: {
        type: Number,
        default: 0,
        min: 0,
      },

      grossPay: {
        type: Number,
        default: 0,
        min: 0,
      },

      netPay: {
        type: Number,
        default: 0,
        min: 0,
      },

      status: {
        type: String,
        enum: ["Pending", "Processed", "Paid", "Held"],
        default: "Pending",
        index: true,
      },

      notes: {
        type: String,
        trim: true,
        default: "",
        maxlength: 2000,
      },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      isDeleted: {
        type: Boolean,
        default: false,
        index: true,
      },

      deletedAt: {
        type: Date,
        default: null,
      },
    },
    { timestamps: true }
  );

  PayrollItemSchema.pre("validate", function (next) {
    const basicSalary = Number(this.basicSalary || 0);
    const allowances = Number(this.allowances || 0);
    const bonuses = Number(this.bonuses || 0);
    const deductions = Number(this.deductions || 0);

    this.grossPay = basicSalary + allowances + bonuses;
    this.netPay = Math.max(0, this.grossPay - deductions);

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