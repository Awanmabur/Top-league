const mongoose = require("mongoose");

module.exports = function MessageTemplateModel(conn) {
  if (!conn) throw new Error("MessageTemplate model requires a DB connection");
  if (conn.models.MessageTemplate) return conn.models.MessageTemplate;

  const MessageTemplateSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      subject: { type: String, required: true, trim: true, maxlength: 220 },
      body: { type: String, required: true, trim: true, maxlength: 5000 },
      type: { type: String, enum: ["General", "Notice", "Reminder", "Alert", "Invitation"], default: "General" },
      priority: { type: String, enum: ["Normal", "Important"], default: "Normal" },
      audienceType: {
        type: String,
        enum: ["All Students", "All Staff", "Specific Department", "Specific Program", "Specific Subject", "Year/Cohort"],
        default: "All Students",
      },
      audienceValue: { type: String, trim: true, default: "—", maxlength: 180 },
      senderName: { type: String, trim: true, default: "", maxlength: 180 },
      replyTo: { type: String, trim: true, default: "", maxlength: 180 },
      channels: {
        portal: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sms: { type: Boolean, default: false },
        push: { type: Boolean, default: false },
      },
      isActive: { type: Boolean, default: true, index: true },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  MessageTemplateSchema.index({ isDeleted: 1, isActive: 1, name: 1 });
  return conn.model("MessageTemplate", MessageTemplateSchema);
};
