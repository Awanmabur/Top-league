// src/models/tenant/Staff.js
const mongoose = require("mongoose");

module.exports = function StaffModel(conn) {
  if (!conn) throw new Error("Staff model requires a DB connection");

  const StaffSchema = new mongoose.Schema(
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

      employeeId: { type: String, trim: true, default: "", index: true },
      firstName: { type: String, trim: true, required: true },
      lastName: { type: String, trim: true, required: true },
      middleName: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "", index: true },
      phone: { type: String, trim: true, default: "" },
      gender: { type: String, enum: ["Male", "Female", "Other", ""], default: "" },

      departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
      roleId: { type: mongoose.Schema.Types.ObjectId, ref: "StaffRole", default: null, index: true },
      employmentType: {
        type: String,
        enum: ["Full Time", "Part Time", "Contract", "Temporary", "Intern"],
        default: "Full Time",
      },
      jobTitle: { type: String, trim: true, default: "" },

      joinDate: { type: Date, default: null },
      endDate: { type: Date, default: null },

      salary: { type: Number, default: 0 },
      payrollNumber: { type: String, trim: true, default: "" },
      bankName: { type: String, trim: true, default: "" },
      bankAccountName: { type: String, trim: true, default: "" },
      bankAccountNumber: { type: String, trim: true, default: "" },

      status: {
        type: String,
        enum: ["Active", "On Leave", "Suspended", "Exited"],
        default: "Active",
        index: true,
      },

      address: { type: String, trim: true, default: "" },
      emergencyContactName: { type: String, trim: true, default: "" },
      emergencyContactPhone: { type: String, trim: true, default: "" },

      notes: { type: String, trim: true, default: "" },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  StaffSchema.index({ isDeleted: 1, status: 1, departmentId: 1, createdAt: -1 });
  StaffSchema.index({ firstName: 1, lastName: 1, email: 1, employeeId: 1 });

  return conn.models.Staff || conn.model("Staff", StaffSchema);
};