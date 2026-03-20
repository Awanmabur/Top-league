const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Course) return connection.models.Course;

  const CourseSchema = new Schema(
    {
      title: { type: String, required: true, trim: true },
      code: { type: String, required: true, unique: true, trim: true, uppercase: true },
      shortTitle: { type: String, default: "", trim: true },

      department: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
      program: { type: Schema.Types.ObjectId, ref: "Program", default: null, index: true },

      level: { type: String, default: "", trim: true },
      yearOfStudy: { type: Number, default: 1, min: 0, max: 20, index: true },
      semester: { type: Number, default: 1, min: 0, max: 6, index: true },

      credits: { type: Number, default: 0, min: 0, max: 60 },
      contactHours: { type: Number, default: 0, min: 0, max: 500 },

      type: { type: String, enum: ["core", "elective", "general"], default: "core", index: true },
      studyMode: { type: String, enum: ["day", "evening", "weekend", "online"], default: "day", index: true },

      status: { type: String, enum: ["active", "draft", "archived"], default: "active", index: true },

      description: { type: String, default: "" },
      objectives: { type: String, default: "" },
      outline: { type: String, default: "" },

      prerequisites: [{ type: Schema.Types.ObjectId, ref: "Course" }],

      coordinator: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
      lecturer: { type: Schema.Types.ObjectId, ref: "Staff", default: null },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  CourseSchema.index({ title: 1 });
  CourseSchema.index({ code: 1 });
  CourseSchema.index({ program: 1, yearOfStudy: 1, semester: 1 });
  CourseSchema.index({ department: 1, type: 1, status: 1 });

  return connection.model("Course", CourseSchema);
};