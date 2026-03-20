const { Schema } = require("mongoose");

module.exports = (connection) => {
  // Prevent OverwriteModelError
  if (connection.models.ApplicantDocument) {
    return connection.models.ApplicantDocument;
  }

  const DocSchema = new Schema(
    {
      applicantId: { type: Schema.Types.ObjectId, ref: "Applicant", required: true },
      type: {
        type: String,
        enum: [
          "passport_photo",
          "national_id",
          "certificate",
          "transcript",
          "recommendation",
          "other"
        ],
        required: true,
      },
      filePath: { type: String, required: true },
      originalName: String,
      mimeType: String,
    },
    { timestamps: true }
  );

  return connection.model("ApplicantDocument", DocSchema);
};
