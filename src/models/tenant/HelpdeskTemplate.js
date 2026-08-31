const mongoose = require("mongoose");

module.exports = function HelpdeskTemplateModel(conn) {
  if (!conn) throw new Error("HelpdeskTemplate model requires a DB connection");
  if (conn.models.HelpdeskTemplate) return conn.models.HelpdeskTemplate;

  const HelpdeskTemplateSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      subject: { type: String, trim: true, maxlength: 220, default: "" },
      body: { type: String, required: true, trim: true, maxlength: 5000 },
      category: {
        type: String,
        enum: ["General", "Technical", "Finance", "Admissions", "Library", "Hostel", "Academic", "Attendance"],
        default: "General",
      },
      priority: {
        type: String,
        enum: ["Low", "Medium", "High", "Urgent"],
        default: "Medium",
      },
      isActive: { type: Boolean, default: true, index: true },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  HelpdeskTemplateSchema.index({ name: 1, isDeleted: 1 }, { unique: true });
  HelpdeskTemplateSchema.index({ isActive: 1, category: 1, updatedAt: -1 });

  return conn.model("HelpdeskTemplate", HelpdeskTemplateSchema);
};
