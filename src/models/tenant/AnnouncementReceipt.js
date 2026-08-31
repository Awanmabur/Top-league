const mongoose = require("mongoose");

module.exports = function AnnouncementReceiptModel(conn) {
  if (!conn) throw new Error("AnnouncementReceipt model requires a DB connection");
  if (conn.models.AnnouncementReceipt) return conn.models.AnnouncementReceipt;

  const AnnouncementReceiptSchema = new mongoose.Schema(
    {
      announcementId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Announcement",
        required: true,
        index: true,
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
      name: { type: String, trim: true, default: "", maxlength: 180 },
      email: { type: String, trim: true, lowercase: true, default: "", maxlength: 180 },
      role: { type: String, trim: true, default: "", maxlength: 60 },
      status: {
        type: String,
        enum: ["Unread", "Read", "Acknowledged"],
        default: "Unread",
        index: true,
      },
      readAt: { type: Date, default: null },
      ackAt: { type: Date, default: null },
      reminderCount: { type: Number, default: 0, min: 0 },
      lastRemindedAt: { type: Date, default: null },
      emailDeliveryStatus: {
        type: String,
        enum: ["Not Requested", "Pending", "Sent", "Failed"],
        default: "Not Requested",
      },
      emailDeliveredAt: { type: Date, default: null },
      emailError: { type: String, trim: true, default: "", maxlength: 500 },
    },
    { timestamps: true }
  );

  AnnouncementReceiptSchema.index(
    { announcementId: 1, userId: 1 },
    { unique: true }
  );
  AnnouncementReceiptSchema.index({ announcementId: 1, status: 1, createdAt: 1 });
  AnnouncementReceiptSchema.index({ userId: 1, status: 1, createdAt: -1 });

  return conn.model("AnnouncementReceipt", AnnouncementReceiptSchema);
};
