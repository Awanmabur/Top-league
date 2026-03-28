const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Result) return connection.models.Result;

  const ResultSchema = new Schema(
    {
      exam: { type: Schema.Types.ObjectId, ref: "Exam", required: true, index: true },
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },

      classGroup: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },
      subject: { type: Schema.Types.ObjectId, ref: "Subject", default: null, index: true },

      academicYear: { type: String, default: "", trim: true, index: true },
      term: { type: Number, default: 1, min: 1, max: 3, index: true },

      totalMarks: { type: Number, default: 100, min: 0, max: 100000 },
      score: { type: Number, default: 0, min: 0, max: 100000 },
      percentage: { type: Number, default: 0, min: 0, max: 100 },

      grade: { type: String, default: "", trim: true, index: true },
      remark: { type: String, default: "", trim: true, maxlength: 300 },

      status: { type: String, enum: ["draft", "published"], default: "draft", index: true },

      enteredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      publishedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  ResultSchema.index({ exam: 1, student: 1 }, { unique: true });

  return connection.model("Result", ResultSchema);
};