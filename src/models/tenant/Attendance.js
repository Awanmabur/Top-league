const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Attendance) return connection.models.Attendance;

  const AttendanceSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },

      // Exact session time (supports multiple sessions in a day)
      sessionAt: { type: Date, required: true, index: true },

      status: {
        type: String,
        enum: ["present", "absent", "late", "excused"],
        default: "present",
        index: true,
      },

      notes: { type: String, trim: true, maxlength: 500 },

      // audit
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      // soft delete
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
    },
    { timestamps: true }
  );

  // Per-tenant DB unique constraint
  AttendanceSchema.index(
    { student: 1, course: 1, sessionAt: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  AttendanceSchema.pre("save", function (next) {
    if (this.notes) this.notes = String(this.notes).trim().replace(/\s+/g, " ").slice(0, 500);
    next();
  });

  AttendanceSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("Attendance", AttendanceSchema);
};
