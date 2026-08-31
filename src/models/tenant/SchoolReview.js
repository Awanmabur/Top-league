const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.SchoolReview) return connection.models.SchoolReview;

  const SchoolReviewSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      email: { type: String, trim: true, lowercase: true, maxlength: 120 },
      rating: { type: Number, required: true, min: 1, max: 5 },
      title: { type: String, default: "", trim: true, maxlength: 120 },
      message: { type: String, default: "", trim: true, maxlength: 1200 },

      status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      featured: { type: Boolean, default: false },

      ipHash: { type: String, default: "" },
      userAgent: { type: String, default: "", maxlength: 200, select: false },
      userAgentHash: { type: String, default: "", trim: true, maxlength: 128 },
      fingerprint: { type: String, default: "", trim: true, maxlength: 128 },
      submitterHash: { type: String, default: "", trim: true, maxlength: 128 },
      legacySourceId: { type: String, default: "", trim: true, maxlength: 120 },
      revision: { type: Number, default: 1, min: 1 },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      reviewedAt: { type: Date, default: null },
      approvedAt: { type: Date, default: null },
      rejectedReason: { type: String, default: "", trim: true, maxlength: 500 },
      moderationHistory: { type: [{
        action: { type: String, enum: ["approved", "rejected", "featured", "unfeatured", "deleted"] },
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: "User", default: null },
        reason: { type: String, default: "", trim: true, maxlength: 500 },
      }], default: () => [] },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  SchoolReviewSchema.index({ isDeleted: 1, status: 1, featured: -1, createdAt: -1 });
  SchoolReviewSchema.index({ fingerprint: 1, createdAt: -1 });
  SchoolReviewSchema.index({ submitterHash: 1, createdAt: -1 });

  return connection.model("SchoolReview", SchoolReviewSchema);
};
