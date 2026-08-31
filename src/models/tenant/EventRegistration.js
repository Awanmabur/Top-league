const mongoose = require("mongoose");

module.exports = function EventRegistrationModel(conn) {
  if (!conn) throw new Error("EventRegistration model requires a DB connection");
  if (conn.models.EventRegistration) return conn.models.EventRegistration;

  const EventRegistrationSchema = new mongoose.Schema(
    {
      eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
      studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null, index: true },
      identityKey: { type: String, required: true, trim: true, maxlength: 260 },
      name: { type: String, trim: true, default: "", maxlength: 180 },
      email: { type: String, trim: true, lowercase: true, default: "", maxlength: 180 },
      role: { type: String, trim: true, default: "Student", maxlength: 60 },
      status: {
        type: String,
        enum: ["Registered", "Checked In", "Absent", "Cancelled"],
        default: "Registered",
        index: true,
      },
      registeredAt: { type: Date, default: Date.now },
      checkedInAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },
      reminderCount: { type: Number, default: 0, min: 0 },
      lastRemindedAt: { type: Date, default: null },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  EventRegistrationSchema.index({ eventId: 1, identityKey: 1 }, { unique: true });
  EventRegistrationSchema.index({ eventId: 1, status: 1, registeredAt: 1 });
  EventRegistrationSchema.index({ userId: 1, status: 1, registeredAt: -1 });

  return conn.model("EventRegistration", EventRegistrationSchema);
};
