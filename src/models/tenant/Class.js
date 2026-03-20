const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Class) return connection.models.Class;

  const ClassSchema = new Schema(
    {
      name: { type: String, required: true, trim: true },
      code: { type: String, required: true, unique: true, trim: true, uppercase: true },

      program: { type: Schema.Types.ObjectId, ref: "Program", default: null, index: true },
      department: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },

      academicYear: { type: String, default: "", trim: true, index: true },
      yearOfStudy: { type: Number, default: 1, min: 0, max: 20, index: true },
      semester: { type: Number, default: 1, min: 0, max: 6, index: true },
      section: { type: String, default: "A", trim: true },

      studyMode: { type: String, enum: ["day", "evening", "weekend", "online"], default: "day", index: true },
      intake: { type: String, default: "", trim: true },

      capacity: { type: Number, default: 0, min: 0, max: 100000 },
      enrolledCount: { type: Number, default: 0, min: 0, max: 100000 },

      advisor: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
      meetingRoom: { type: String, default: "", trim: true },
      campus: { type: String, default: "", trim: true },

      status: { type: String, enum: ["active", "inactive", "archived"], default: "active", index: true },
      description: { type: String, default: "" },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  ClassSchema.index({ name: 1 });
  ClassSchema.index({ status: 1, createdAt: -1 });

  ClassSchema.pre("validate", async function (next) {
    try {
      if (this.program) {
        const Program = this.constructor.db.model("Program");
        const p = await Program.findById(this.program).select("department").lean();
        if (p?.department) this.department = p.department;
      }
      next();
    } catch (e) {
      next(e);
    }
  });

  return connection.model("Class", ClassSchema);
};