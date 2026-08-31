const mongoose = require("mongoose");

module.exports = function MessageRecipientModel(conn) {
  if (!conn) throw new Error("MessageRecipient model requires a DB connection");
  if (conn.models.MessageRecipient) return conn.models.MessageRecipient;

  const MessageRecipientSchema = new mongoose.Schema(
    {
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true, index: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
      name: { type: String, trim: true, default: "", maxlength: 180 },
      email: { type: String, trim: true, lowercase: true, default: "", maxlength: 180 },
      role: { type: String, trim: true, default: "", maxlength: 60 },
      status: {
        type: String,
        enum: ["Pending", "Delivered", "Opened", "Failed"],
        default: "Pending",
        index: true,
      },
      deliveredAt: { type: Date, default: null },
      openedAt: { type: Date, default: null },
      portalDeliveryStatus: {
        type: String,
        enum: ["Not Requested", "Pending", "Delivered", "Failed"],
        default: "Not Requested",
      },
      portalDeliveredAt: { type: Date, default: null },
      emailDeliveryStatus: {
        type: String,
        enum: ["Not Requested", "Pending", "Sent", "Failed"],
        default: "Not Requested",
      },
      emailDeliveredAt: { type: Date, default: null },
      emailError: { type: String, trim: true, default: "", maxlength: 500 },
      reminderCount: { type: Number, default: 0, min: 0 },
      lastRemindedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  MessageRecipientSchema.index({ messageId: 1, userId: 1 }, { unique: true });
  MessageRecipientSchema.index({ messageId: 1, status: 1, createdAt: 1 });
  MessageRecipientSchema.index({ userId: 1, status: 1, createdAt: -1 });

  return conn.model("MessageRecipient", MessageRecipientSchema);
};
