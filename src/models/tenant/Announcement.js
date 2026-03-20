const mongoose = require("mongoose");

module.exports = function AnnouncementModel(conn) {
  if (!conn) throw new Error("Announcement model requires a DB connection");

  const AnnouncementSchema = new mongoose.Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 220 },
      category: {
        type: String,
        enum: ["Academic", "Finance", "Hostel", "Library", "Exams", "General", "Emergency"],
        default: "General",
      },
      priority: {
        type: String,
        enum: ["Normal", "Pinned"],
        default: "Normal",
      },
      audienceType: {
        type: String,
        enum: [
          "All Students",
          "All Staff",
          "Specific Department",
          "Specific Program",
          "Year/Cohort",
          "Hostel Residents",
        ],
        default: "All Students",
      },
      audienceValue: { type: String, trim: true, default: "—" },
      body: { type: String, required: true, trim: true, maxlength: 5000 },
      requiresAcknowledgement: { type: Boolean, default: false },
      channels: {
        portal: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        sms: { type: Boolean, default: false },
        push: { type: Boolean, default: false },
      },
      status: {
        type: String,
        enum: ["Published", "Scheduled", "Draft", "Unpublished"],
        default: "Draft",
      },
      scheduleAt: { type: Date, default: null },
      publishedAt: { type: Date, default: null },
      expiryDate: { type: Date, default: null },
      stats: {
        views: { type: Number, default: 0 },
        emailOpens: { type: Number, default: 0 },
        smsDelivered: { type: Number, default: 0 },
        clicks: { type: Number, default: 0 },
        acknowledgements: { type: Number, default: 0 },
      },
      receipts: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          name: { type: String, trim: true, default: "" },
          email: { type: String, trim: true, lowercase: true, default: "" },
          role: { type: String, trim: true, default: "" },
          status: {
            type: String,
            enum: ["Unread", "Read", "Acknowledged"],
            default: "Unread",
          },
          readAt: { type: Date, default: null },
          ackAt: { type: Date, default: null },
        },
      ],
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  AnnouncementSchema.index({ status: 1, category: 1, audienceType: 1, createdAt: -1 });
  AnnouncementSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.Announcement || conn.model("Announcement", AnnouncementSchema);
};