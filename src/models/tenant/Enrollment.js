const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Enrollment) return connection.models.Enrollment;

  const EnrollmentSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },

      academicYear: { type: String, required: true, trim: true, maxlength: 20, index: true }, // 2025/2026
      semester: { type: Number, min: 1, max: 6, default: 1, index: true },

      program: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
      classGroup: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },

      intake: { type: String, trim: true, maxlength: 40, index: true },

      status: {
        type: String,
        enum: ["enrolled", "deferred", "withdrawn", "completed"],
        default: "enrolled",
        index: true,
      },

      enrolledAt: { type: Date, default: Date.now },
      note: { type: String, trim: true, maxlength: 400 },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  EnrollmentSchema.index(
    { student: 1, academicYear: 1, semester: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  EnrollmentSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("Enrollment", EnrollmentSchema);
};
