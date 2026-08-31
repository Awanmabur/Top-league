const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.SchoolInquiry) return connection.models.SchoolInquiry;

  const SchoolInquirySchema = new Schema(
    {
      schoolCode: { type: String, default: "", trim: true, lowercase: true, maxlength: 80 },
      name: { type: String, required: true, trim: true, maxlength: 100 },
      contact: { type: String, required: true, trim: true, maxlength: 120 },
      message: { type: String, required: true, trim: true, maxlength: 2000 },
      status: {
        type: String,
        enum: ["new", "read", "resolved"],
        default: "new",
        index: true,
      },
      readAt: { type: Date, default: null },
      readBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      resolvedAt: { type: Date, default: null },
      resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      ipHash: { type: String, default: "", maxlength: 128 },
      userAgent: { type: String, default: "", maxlength: 200, select: false },
      userAgentHash: { type: String, default: "", maxlength: 128, select: false },
    },
    { timestamps: true }
  );

  SchoolInquirySchema.index({ isDeleted: 1, status: 1, createdAt: -1 });
  SchoolInquirySchema.index({ createdAt: -1 });

  return connection.model("SchoolInquiry", SchoolInquirySchema);
};
