const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.SchoolFAQ) return connection.models.SchoolFAQ;

  const SchoolFAQSchema = new Schema(
    {
      q: { type: String, required: true, trim: true, maxlength: 160 },
      a: { type: String, required: true, trim: true, maxlength: 900 },
      order: { type: Number, default: 0 },
      isPublished: { type: Boolean, default: true },
    },
    { timestamps: true }
  );

  SchoolFAQSchema.index({ isPublished: 1, order: 1 });

  return connection.model("SchoolFAQ", SchoolFAQSchema);
};
