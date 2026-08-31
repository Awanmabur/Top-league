const mongoose = require("mongoose");

const STATUSES = ["active", "inactive", "archived"];

function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function code(value, fallback = "") {
  return String(value || fallback || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

module.exports = function DepartmentModel(conn) {
  if (!conn) throw new Error("Department model requires a DB connection");
  if (conn.models.Department) return conn.models.Department;

  const DepartmentSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 180 },
      code: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
      description: { type: String, trim: true, default: "", maxlength: 2000 },
      costCenter: { type: String, trim: true, default: "", maxlength: 80 },
      schoolUnitId: { type: String, trim: true, default: "", maxlength: 80, index: true },
      schoolUnitName: { type: String, trim: true, default: "", maxlength: 180 },
      headStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null, index: true },
      status: { type: String, enum: STATUSES, default: "active", index: true },
      migrationQuarantinedAt: { type: Date, default: null },
      migrationReason: { type: String, trim: true, default: "", maxlength: 300 },

      revision: { type: Number, default: 1, min: 1 },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  DepartmentSchema.pre("validate", function normalizeDepartment(next) {
    this.name = text(this.name, 180);
    this.code = code(this.code, this.name);
    this.description = text(this.description, 2000);
    this.costCenter = text(this.costCenter, 80);
    this.schoolUnitId = text(this.schoolUnitId, 80);
    this.schoolUnitName = text(this.schoolUnitName, 180);
    if (!this.name) this.invalidate("name", "Department name is required.");
    if (!this.code) this.invalidate("code", "Department code is required.");
    next();
  });

  DepartmentSchema.index(
    { code: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
  );
  DepartmentSchema.index({ isDeleted: 1, status: 1, name: 1 });

  return conn.model("Department", DepartmentSchema);
};
