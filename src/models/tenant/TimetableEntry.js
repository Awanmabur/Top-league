const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.TimetableEntry) return connection.models.TimetableEntry;

  const TimetableEntrySchema = new Schema(
    {
      academicYear: { type: String, default: "", trim: true, index: true }, // e.g. 2025/2026
      semester: { type: Number, default: 1, min: 0, max: 6, index: true },  // 1,2...
      term: { type: String, default: "", trim: true },                      // optional

      // main links
      classGroup: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },
      course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
      lecturer: { type: Schema.Types.ObjectId, ref: "Staff", default: null, index: true },

      // location
      room: { type: String, default: "", trim: true, index: true },
      campus: { type: String, default: "", trim: true },

      // time
      dayOfWeek: {
        type: String,
        enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        required: true,
        index: true,
      },
      startTime: { type: String, required: true }, // "08:00"
      endTime: { type: String, required: true },   // "10:00"
      startMinutes: { type: Number, required: true, min: 0, max: 1439, index: true },
      endMinutes: { type: Number, required: true, min: 1, max: 1440, index: true },

      // recurrence
      weekPattern: { type: String, enum: ["all", "odd", "even"], default: "all", index: true },

      status: { type: String, enum: ["active", "inactive", "archived"], default: "active", index: true },

      note: { type: String, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  TimetableEntrySchema.index({ classGroup: 1, dayOfWeek: 1, startMinutes: 1 });
  TimetableEntrySchema.index({ lecturer: 1, dayOfWeek: 1, startMinutes: 1 });
  TimetableEntrySchema.index({ room: 1, dayOfWeek: 1, startMinutes: 1 });

  return connection.model("TimetableEntry", TimetableEntrySchema);
};
