const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PlatformBooking) return connection.models.PlatformBooking;

  const PlatformBookingSchema = new Schema(
    {
      bookingCode: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
      slotSegments: [{ type: String, required: true, trim: true, maxlength: 80 }],
      blocksSlot: { type: Boolean, default: true },
      status: {
        type: String,
        enum: ["claimed", "confirmed", "failed", "cancelled"],
        default: "claimed",
        index: true,
      },
      claimExpiresAt: { type: Date, default: null },
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      timezone: { type: String, required: true, trim: true, maxlength: 80 },
      durationMin: { type: Number, required: true, min: 15, max: 180 },
      product: { type: String, required: true, trim: true, maxlength: 80 },
      purpose: { type: String, required: true, trim: true, maxlength: 80 },
      company: { type: String, default: "", trim: true, maxlength: 200 },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
      phone: { type: String, default: "", trim: true, maxlength: 60 },
      notes: { type: String, default: "", trim: true, maxlength: 2000 },
      zoomMeetingId: { type: String, default: "", trim: true, maxlength: 120 },
      calendarEventId: { type: String, default: "", trim: true, maxlength: 220 },
      calendarHtmlLink: { type: String, default: "", trim: true, maxlength: 1000 },
      failureReason: { type: String, default: "", trim: true, maxlength: 1000 },
      ipHash: { type: String, default: "", trim: true, maxlength: 128, select: false },
      userAgentHash: { type: String, default: "", trim: true, maxlength: 128, select: false },
      revision: { type: Number, default: 1, min: 1 },
    },
    { timestamps: true },
  );

  PlatformBookingSchema.index(
    { slotSegments: 1 },
    {
      unique: true,
      partialFilterExpression: { blocksSlot: true },
      name: "uniq_platform_booking_slot_segment",
    },
  );
  PlatformBookingSchema.index({ status: 1, startAt: 1 });
  PlatformBookingSchema.index({ blocksSlot: 1, claimExpiresAt: 1 });
  PlatformBookingSchema.index({ email: 1, createdAt: -1 });

  return connection.model("PlatformBooking", PlatformBookingSchema);
};
