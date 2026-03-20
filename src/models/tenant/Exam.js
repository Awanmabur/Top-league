const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Exam) return connection.models.Exam;

  const ExamSchema = new Schema(
    {
      title: { type: String, required: true, trim: true }, // e.g., "Midterm Exam"
      examType: { type: String, enum: ["midterm", "final", "quiz", "test", "mock", "practical", "other"], default: "final", index: true },

      academicYear: { type: String, default: "", trim: true, index: true },
      semester: { type: Number, default: 1, min: 0, max: 6, index: true },

      classGroup: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },
      program: { type: Schema.Types.ObjectId, ref: "Program", default: null, index: true },
      course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },

      date: { type: Date, required: true, index: true },
      dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD
      startTime: { type: String, required: true },   // "09:00"
      endTime: { type: String, required: true },     // "12:00"
      startMinutes: { type: Number, required: true, min: 0, max: 1439, index: true },
      endMinutes: { type: Number, required: true, min: 1, max: 1440, index: true },

      durationMinutes: { type: Number, default: 120, min: 1, max: 1440 },

      room: { type: String, default: "", trim: true, index: true },
      campus: { type: String, default: "", trim: true },

      invigilator: { type: Schema.Types.ObjectId, ref: "Staff", default: null, index: true },
      instructions: { type: String, default: "" },

      totalMarks: { type: Number, default: 100, min: 0, max: 100000 },
      passMark: { type: Number, default: 50, min: 0, max: 100000 },

      status: { type: String, enum: ["scheduled", "ongoing", "completed", "archived"], default: "scheduled", index: true },

      // Optional structure for paper/section-based exams
      papers: [
        {
          name: { type: String, default: "Paper 1" },
          marks: { type: Number, default: 0, min: 0, max: 100000 },
          durationMinutes: { type: Number, default: 0, min: 0, max: 1440 },
        },
      ],

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  ExamSchema.index({ classGroup: 1, date: 1, startMinutes: 1 });
  ExamSchema.index({ invigilator: 1, date: 1, startMinutes: 1 });
  ExamSchema.index({ room: 1, date: 1, startMinutes: 1 });


  ExamSchema.pre("validate", async function (next) {
    try {
      if (this.classGroup) {
        const Class = this.constructor.db.model("Class");
        const cg = await Class.findById(this.classGroup)
          .select("program academicYear semester")
          .lean();

        if (cg) {
          this.program = cg.program || this.program;
          this.academicYear = cg.academicYear || this.academicYear;
          this.semester = cg.semester || this.semester;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  

  return connection.model("Exam", ExamSchema);
};
