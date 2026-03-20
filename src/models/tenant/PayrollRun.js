const mongoose = require("mongoose");

module.exports = function PayrollRunModel(conn) {
  if (!conn) throw new Error("PayrollRun model requires a DB connection");

  const PayrollRunSchema = new mongoose.Schema(
    {
      title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 180,
      },

      periodLabel: {
        type: String,
        trim: true,
        default: "",
        maxlength: 120,
      },

      month: {
        type: String,
        required: true,
        trim: true,
        enum: [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ],
      },

      year: {
        type: Number,
        required: true,
        min: 2000,
        max: 3000,
      },

      departmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        default: null,
        index: true,
      },

      payDate: {
        type: Date,
        default: null,
      },

      status: {
        type: String,
        enum: ["Draft", "Processed", "Approved", "Closed"],
        default: "Draft",
        index: true,
      },

      staffCount: {
        type: Number,
        default: 0,
        min: 0,
      },

      grossAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      deductionsAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      netAmount: {
        type: Number,
        default: 0,
        min: 0,
      },

      notes: {
        type: String,
        trim: true,
        default: "",
        maxlength: 3000,
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

  PayrollRunSchema.index({ year: -1, month: 1, status: 1 });
  PayrollRunSchema.index({ departmentId: 1, year: -1, month: 1 });
  PayrollRunSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.PayrollRun || conn.model("PayrollRun", PayrollRunSchema);
};