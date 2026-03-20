const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Faculty) return connection.models.Faculty;

  const FacultySchema = new Schema(
    {
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, unique: true, trim: true, uppercase: true },

      description: { type: String, default: "" },
      status: { type: String, enum: ["active", "inactive"], default: "active", index: true },

      // Contact / details (frontend-ready)
      officeLocation: { type: String, default: "" },
      publicEmail: { type: String, default: "" },
      phone: { type: String, default: "" },

      // Leadership
      dean: { type: Schema.Types.ObjectId, ref: "Staff", default: null },

      /* =========================
         ✅ DB-linked relationships
         ========================= */
      departments: { type: [Schema.Types.ObjectId], ref: "Department", default: [] },
      programs: { type: [Schema.Types.ObjectId], ref: "Program", default: [] },
      courses: { type: [Schema.Types.ObjectId], ref: "Course", default: [] },

      /* =========================
         ✅ Optional cached labels for fast UI display
         (keep these so old UI/data still works)
         ========================= */
      departmentLabels: { type: [String], default: [] }, // e.g. "Computer Science"
      programLabels: { type: [String], default: [] },    // e.g. "BSc CS"
      courseLabels: { type: [String], default: [] },     // e.g. "Data Structures"

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null }
    },
    { timestamps: true }
  );

  FacultySchema.index({ name: 1 });

  // Helpful for searching by linked entities quickly (optional but good)
  FacultySchema.index({ departments: 1 });
  FacultySchema.index({ programs: 1 });
  FacultySchema.index({ courses: 1 });

  return connection.model("Faculty", FacultySchema);
};