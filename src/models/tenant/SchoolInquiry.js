const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.SchoolInquiry) return connection.models.SchoolInquiry;

  const SchoolInquirySchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      contact: { type: String, required: true, trim: true, maxlength: 120 },
      message: { type: String, required: true, trim: true, maxlength: 2000 },

      ipHash: { type: String, default: "" },
      userAgent: { type: String, default: "", maxlength: 200 },
    },
    { timestamps: true }
  );

  SchoolInquirySchema.index({ createdAt: -1 });

  return connection.model("SchoolInquiry", SchoolInquirySchema);
};
