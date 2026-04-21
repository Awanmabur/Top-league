const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.TimetableEntry) return connection.models.TimetableEntry;

  const TimetableEntrySchema = new Schema(
    {
      academicYear: { type: String, default: "", trim: true, index: true }, // e.g. 2026
      term: { type: Number, default: 1, min: 1, max: 3, index: true },

      classGroup: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },
      sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },
      sectionName: { type: String, default: "", trim: true },
      sectionCode: { type: String, default: "", trim: true },
      streamId: { type: Schema.Types.ObjectId, ref: "Stream", default: null, index: true },
      streamName: { type: String, default: "", trim: true },
      streamCode: { type: String, default: "", trim: true },
      subject: { type: Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
      teacher: { type: Schema.Types.ObjectId, ref: "Staff", default: null, index: true },

      room: { type: String, default: "", trim: true, index: true },
      campus: { type: String, default: "", trim: true },

      dayOfWeek: {
        type: String,
        enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        required: true,
        index: true,
      },

      startTime: { type: String, required: true }, // "08:00"
      endTime: { type: String, required: true },   // "09:00"
      startMinutes: { type: Number, required: true, min: 0, max: 1439, index: true },
      endMinutes: { type: Number, required: true, min: 1, max: 1440, index: true },

      weekPattern: { type: String, enum: ["all", "odd", "even"], default: "all", index: true },

      status: {
        type: String,
        enum: ["active", "inactive", "archived"],
        default: "active",
        index: true,
      },

      note: { type: String, default: "", trim: true },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  TimetableEntrySchema.index({ classGroup: 1, dayOfWeek: 1, startMinutes: 1, academicYear: 1, term: 1 });
  TimetableEntrySchema.index({ classGroup: 1, sectionId: 1, streamId: 1, academicYear: 1, term: 1 });
  TimetableEntrySchema.index({ teacher: 1, dayOfWeek: 1, startMinutes: 1, academicYear: 1, term: 1 });
  TimetableEntrySchema.index({ room: 1, dayOfWeek: 1, startMinutes: 1, academicYear: 1, term: 1 });

  return connection.model("TimetableEntry", TimetableEntrySchema);
};
