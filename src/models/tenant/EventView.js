const mongoose = require("mongoose");

module.exports = function EventViewModel(conn) {
  if (!conn) throw new Error("EventView model requires a DB connection");
  if (conn.models.EventView) return conn.models.EventView;

  const EventViewSchema = new mongoose.Schema(
    {
      eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
      firstViewedAt: { type: Date, default: Date.now },
      lastViewedAt: { type: Date, default: Date.now },
      viewCount: { type: Number, default: 1, min: 1 },
    },
    { timestamps: true }
  );
  EventViewSchema.index({ eventId: 1, userId: 1 }, { unique: true });
  EventViewSchema.index({ eventId: 1, firstViewedAt: -1 });
  return conn.model("EventView", EventViewSchema);
};
