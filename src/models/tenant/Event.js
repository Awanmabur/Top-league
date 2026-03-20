const mongoose = require("mongoose");

module.exports = function EventModel(conn) {
  if (!conn) throw new Error("Event model requires a DB connection");

  const AttendanceSchema = new mongoose.Schema(
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      role: { type: String, trim: true, default: "" },
      status: {
        type: String,
        enum: ["Registered", "Checked In", "Absent"],
        default: "Registered",
      },
      registeredAt: { type: Date, default: null },
      checkedInAt: { type: Date, default: null },
    },
    { _id: true }
  );

  const EventSchema = new mongoose.Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 220 },
      type: {
        type: String,
        enum: ["Academic", "Sports", "Seminar", "Workshop", "Conference", "Social", "General"],
        default: "General",
      },
      priority: {
        type: String,
        enum: ["Normal", "Featured"],
        default: "Normal",
      },
      audienceType: {
        type: String,
        enum: ["All Students", "All Staff", "Specific Department", "Specific Program", "Year/Cohort", "Open Event"],
        default: "Open Event",
      },
      audienceValue: { type: String, trim: true, default: "—" },
      venue: { type: String, trim: true, default: "" },
      description: { type: String, required: true, trim: true, maxlength: 5000 },
      startAt: { type: Date, default: null },
      endAt: { type: Date, default: null },
      registrationDeadline: { type: Date, default: null },
      capacity: { type: Number, default: 0, min: 0 },
      status: {
        type: String,
        enum: ["Published", "Scheduled", "Draft", "Cancelled"],
        default: "Draft",
      },
      scheduleAt: { type: Date, default: null },
      publishedAt: { type: Date, default: null },
      stats: {
        views: { type: Number, default: 0 },
        registrations: { type: Number, default: 0 },
        checkIns: { type: Number, default: 0 },
      },
      attendance: { type: [AttendanceSchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  EventSchema.index({ status: 1, type: 1, audienceType: 1, startAt: 1, createdAt: -1 });
  EventSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Event || conn.model("Event", EventSchema);
};