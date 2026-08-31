const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.SchoolFAQ) return connection.models.SchoolFAQ;

  const SchoolFAQSchema = new Schema(
    {
      q: { type: String, required: true, trim: true, maxlength: 160 },
      a: { type: String, required: true, trim: true, maxlength: 900 },
      order: { type: Number, default: 0 },
      isPublished: { type: Boolean, default: true },
      revision: { type: Number, default: 1, min: 1 },
      legacySourceId: { type: String, default: "", trim: true, maxlength: 120 },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  SchoolFAQSchema.index({ isDeleted: 1, isPublished: 1, order: 1 });

  return connection.model("SchoolFAQ", SchoolFAQSchema);
};
