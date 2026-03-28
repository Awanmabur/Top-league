const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Exam) return connection.models.Exam;

  const ExamSchema = new Schema(
    {
      title: {
        type: String,
        required: true,
        trim: true,
        index: true,
      },

      code: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        index: true,
      },

      classGroup: {
        type: Schema.Types.ObjectId,
        ref: "Class",
        required: true,
        index: true,
      },

      subject: {
        type: Schema.Types.ObjectId,
        ref: "Subject",
        required: true,
        index: true,
      },

      teacher: {
        type: Schema.Types.ObjectId,
        ref: "Staff",
        default: null,
        index: true,
      },

      academicYear: {
        type: String,
        default: "",
        trim: true,
        index: true,
      },

      term: {
        type: Number,
        default: 1,
        min: 1,
        max: 3,
        index: true,
      },

      examType: {
        type: String,
        enum: ["test", "quiz", "midterm", "endterm", "mock", "practical", "oral", "assignment"],
        default: "test",
        index: true,
      },

      examDate: {
        type: Date,
        required: true,
        index: true,
      },

      startTime: {
        type: String,
        default: "",
        trim: true,
      },

      endTime: {
        type: String,
        default: "",
        trim: true,
      },

      durationMinutes: {
        type: Number,
        default: 0,
        min: 0,
        max: 1440,
      },

      maxMarks: {
        type: Number,
        default: 100,
        min: 0,
        max: 1000,
      },

      passMark: {
        type: Number,
        default: 50,
        min: 0,
        max: 1000,
      },

      room: {
        type: String,
        default: "",
        trim: true,
      },

      campus: {
        type: String,
        default: "",
        trim: true,
      },

      instructions: {
        type: String,
        default: "",
        trim: true,
      },

      status: {
        type: String,
        enum: ["draft", "scheduled", "completed", "archived"],
        default: "draft",
        index: true,
      },

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    { timestamps: true }
  );

  ExamSchema.index(
    { classGroup: 1, subject: 1, academicYear: 1, term: 1, examType: 1, examDate: 1 },
    { unique: true }
  );

  ExamSchema.index({ status: 1, examDate: -1 });

  return connection.model("Exam", ExamSchema);
};