const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Department) return connection.models.Department;

  const DepartmentSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 160 },
      code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30, unique: true },

      status: { type: String, enum: ["active", "inactive"], default: "active", index: true },

      faculty: { type: Schema.Types.ObjectId, ref: "Faculty", default: null, index: true },

      officeLocation: { type: String, trim: true, default: "", maxlength: 120 },
      publicEmail: { type: String, trim: true, lowercase: true, default: "", maxlength: 160 },
      phone: { type: String, trim: true, default: "", maxlength: 40 },

      description: { type: String, trim: true, default: "", maxlength: 1200 },
      notes: { type: String, trim: true, default: "", maxlength: 2000 },

      headOfDepartment: { type: Schema.Types.ObjectId, ref: "Staff", default: null, index: true },

      programs: [{ type: Schema.Types.ObjectId, ref: "Program" }],
      courses: [{ type: Schema.Types.ObjectId, ref: "Course" }],

      programLabels: { type: [String], default: [] },
      courseCodes: { type: [String], default: [] },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  DepartmentSchema.index({ name: 1 });

  DepartmentSchema.pre("validate", function (next) {
    if (this.code) this.code = String(this.code).trim().toUpperCase();
    if (this.name) this.name = String(this.name).trim().replace(/\s+/g, " ");
    next();
  });

  return connection.model("Department", DepartmentSchema);
};