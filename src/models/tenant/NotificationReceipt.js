const { Schema } = require("mongoose");
module.exports = (connection) => {
  if (connection.models.NotificationReceipt) return connection.models.NotificationReceipt;
  const schema = new Schema({
    notificationId: { type: Schema.Types.ObjectId, ref: "Notification", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    readAt: { type: Date, default: null, index: true },
    dismissedAt: { type: Date, default: null },
  }, { timestamps: true });
  schema.index({ notificationId: 1, userId: 1 }, { unique: true });
  schema.index({ userId: 1, readAt: 1, createdAt: -1 });
  return connection.model("NotificationReceipt", schema);
};
