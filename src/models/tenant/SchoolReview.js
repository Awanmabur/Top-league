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
      userAgent: { type: String, default: "", maxlength: 200 },
    },
    { timestamps: true }
  );

  SchoolReviewSchema.index({ status: 1, featured: -1, createdAt: -1 });

  return connection.model("SchoolReview", SchoolReviewSchema);
};
