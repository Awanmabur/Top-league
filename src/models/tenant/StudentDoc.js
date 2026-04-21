const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.StudentDoc) return connection.models.StudentDoc;

  const DocSchema = new Schema(
    {
      url: { type: String, required: true, trim: true, maxlength: 800 },
      publicId: { type: String, required: true, trim: true, maxlength: 300 },
      resourceType: { type: String, trim: true, maxlength: 20, default: "auto" },
      originalName: { type: String, trim: true, maxlength: 200 },
      bytes: { type: Number, default: 0 },
      mimeType: { type: String, trim: true, maxlength: 80 },
      source: { type: String, trim: true, maxlength: 40, default: "" },
      sharedAsset: { type: Boolean, default: false },
      uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false }
  );

  const StudentDocSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      type: { type: String, enum: ["passport", "id", "transcript", "certificate", "other"], default: "other", index: true },
      title: { type: String, required: true, trim: true, maxlength: 120 },

      doc: { type: DocSchema, required: true },

      uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      sourceApplicant: { type: Schema.Types.ObjectId, ref: "Applicant", default: null, index: true },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  StudentDocSchema.index({ createdAt: -1 });
  StudentDocSchema.index({ student: 1, type: 1, isDeleted: 1 });

  StudentDocSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("StudentDoc", StudentDocSchema);
};
