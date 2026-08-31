const mongoose = require("mongoose");

module.exports = function EventSubscriptionModel(conn) {
  if (!conn) throw new Error("EventSubscription model requires a DB connection");
  if (conn.models.EventSubscription) return conn.models.EventSubscription;

  const EventSubscriptionSchema = new mongoose.Schema(
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
      enabled: { type: Boolean, default: true, index: true },
      portal: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  EventSubscriptionSchema.index({ enabled: 1, updatedAt: -1 });
  return conn.model("EventSubscription", EventSubscriptionSchema);
};
