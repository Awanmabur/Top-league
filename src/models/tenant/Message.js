const mongoose = require("mongoose");

module.exports = function MessageModel(conn) {
  if (!conn) throw new Error("Message model requires a DB connection");

  const RecipientSchema = new mongoose.Schema(
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      role: { type: String, trim: true, default: "" },
      status: {
        type: String,
        enum: ["Pending", "Delivered", "Opened", "Failed"],
        default: "Pending",
      },
      deliveredAt: { type: Date, default: null },
      openedAt: { type: Date, default: null },
    },
    { _id: true }
  );

  const MessageSchema = new mongoose.Schema(
    {
      subject: { type: String, required: true, trim: true, maxlength: 220 },
      body: { type: String, required: true, trim: true, maxlength: 5000 },
      type: {
        type: String,
        enum: ["General", "Notice", "Reminder", "Alert", "Invitation"],
        default: "General",
      },
      priority: {
        type: String,
        enum: ["Normal", "Important"],
        default: "Normal",
      },
      audienceType: {
        type: String,
        enum: ["All Students", "All Staff", "Specific Department", "Specific Subject", "Year/Cohort"],
        default: "All Students",
      },
      audienceValue: { type: String, trim: true, default: "—" },
      senderName: { type: String, trim: true, default: "" },
      replyTo: { type: String, trim: true, default: "" },
      channels: {
        portal: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: false },
        push: { type: Boolean, default: false },
      },
      status: {
        type: String,
        enum: ["Sent", "Scheduled", "Draft", "Archived", "Failed"],
        default: "Draft",
      },
      scheduleAt: { type: Date, default: null },
      sentAt: { type: Date, default: null },
      stats: {
        recipients: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        opened: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
      },
      recipients: { type: [RecipientSchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  MessageSchema.index({ status: 1, type: 1, audienceType: 1, createdAt: -1 });
  MessageSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Message || conn.model("Message", MessageSchema);
};
