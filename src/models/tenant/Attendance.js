const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Attendance) return connection.models.Attendance;

  const AttendanceSchema = new Schema(
    {
      student: {
        type: Schema.Types.ObjectId,
        ref: "Student",
        required: true,
        index: true,
      },

      classGroup: {
        type: Schema.Types.ObjectId,
        ref: "Class",
        default: null,
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

      attendanceDate: {
        type: Date,
        required: true,
        index: true,
      },

      sessionAt: {
        type: Date,
        required: true,
        index: true,
      },

      status: {
        type: String,
        enum: ["present", "absent", "late", "excused"],
        default: "present",
        index: true,
      },

      notes: {
        type: String,
        default: "",
        trim: true,
      },

      isDeleted: {
        type: Boolean,
        default: false,
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

  AttendanceSchema.index(
    { student: 1, subject: 1, sessionAt: 1, isDeleted: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $eq: false } } }
  );

  AttendanceSchema.index({ classGroup: 1, attendanceDate: 1, term: 1 });
  AttendanceSchema.index({ subject: 1, attendanceDate: 1, term: 1 });
  AttendanceSchema.index({ student: 1, attendanceDate: 1 });

  return connection.model("Attendance", AttendanceSchema);
};