const mongoose = require("mongoose");

module.exports = function AnnouncementTemplateModel(conn) {
  if (!conn) throw new Error("AnnouncementTemplate model requires a DB connection");
  if (conn.models.AnnouncementTemplate) return conn.models.AnnouncementTemplate;

  const AnnouncementTemplateSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      title: { type: String, required: true, trim: true, maxlength: 220 },
      body: { type: String, required: true, trim: true, maxlength: 5000 },
      category: {
        type: String,
        enum: ["Academic", "Finance", "Hostel", "Library", "Exams", "General", "Emergency"],
        default: "General",
      },
      priority: { type: String, enum: ["Normal", "Pinned"], default: "Normal" },
      audienceType: {
        type: String,
        enum: [
          "All Students",
          "All Staff",
          "All Parents",
          "Specific Department",
          "Specific Program",
          "Specific Subject",
          "Year/Cohort",
          "Hostel Residents",
        ],
        default: "All Students",
      },
      audienceValue: { type: String, trim: true, default: "—", maxlength: 180 },
      requiresAcknowledgement: { type: Boolean, default: false },
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

  AnnouncementTemplateSchema.index({ isDeleted: 1, isActive: 1, name: 1 });

  return conn.model("AnnouncementTemplate", AnnouncementTemplateSchema);
};
