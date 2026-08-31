const mongoose = require("mongoose");

module.exports = function EventTemplateModel(conn) {
  if (!conn) throw new Error("EventTemplate model requires a DB connection");
  if (conn.models.EventTemplate) return conn.models.EventTemplate;

  const EventTemplateSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      title: { type: String, required: true, trim: true, maxlength: 220 },
      description: { type: String, required: true, trim: true, maxlength: 5000 },
      type: {
        type: String,
        enum: ["Academic", "Sports", "Seminar", "Workshop", "Conference", "Social", "General"],
        default: "General",
      },
      priority: { type: String, enum: ["Normal", "Featured"], default: "Normal" },
      audienceType: {
        type: String,
        enum: ["All Students", "All Staff", "Specific Department", "Specific Program", "Specific Subject", "Year/Cohort", "Open Event"],
        default: "Open Event",
      },
      audienceValue: { type: String, trim: true, default: "—", maxlength: 180 },
      venue: { type: String, trim: true, default: "", maxlength: 240 },
      durationMinutes: { type: Number, default: 60, min: 0, max: 10080 },
      capacity: { type: Number, default: 0, min: 0 },
      isActive: { type: Boolean, default: true, index: true },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  EventTemplateSchema.index({ isDeleted: 1, isActive: 1, name: 1 });
  return conn.model("EventTemplate", EventTemplateSchema);
};
