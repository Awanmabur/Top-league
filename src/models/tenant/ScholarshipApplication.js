const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.ScholarshipApplication) return connection.models.ScholarshipApplication;

  const DocSchema = new Schema(
    {
      url: { type: String, trim: true, maxlength: 500 },
      publicId: { type: String, trim: true, maxlength: 200 },
      resourceType: { type: String, trim: true, maxlength: 30, default: "auto" },
      originalName: { type: String, trim: true, maxlength: 200 },
      bytes: { type: Number, default: 0 },
      mimeType: { type: String, trim: true, maxlength: 120 },
    },
    { _id: false }
  );

  const ScholarshipApplicationSchema = new Schema(
    {
      applicationId: { type: String, required: true, trim: true, maxlength: 60 },

      scholarship: { type: Schema.Types.ObjectId, ref: "Scholarship", required: true, index: true },

      // Applicant identity (public OR student)
      student: { type: Schema.Types.ObjectId, ref: "Student", default: null, index: true },
      regNo: { type: String, trim: true, maxlength: 60, default: "" },

      fullName: { type: String, required: true, trim: true, maxlength: 120 },
      email: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" },
      phone: { type: String, trim: true, maxlength: 40, default: "" },

      program: { type: Schema.Types.ObjectId, ref: "Program", default: null, index: true },
      yearLevel: { type: String, trim: true, maxlength: 30, default: "" },
      academicYear: { type: String, trim: true, maxlength: 20, default: "" },

      gpa: { type: Number, min: 0, max: 5, default: null },

      // Narratives
      motivation: { type: String, trim: true, maxlength: 4000, default: "" },
      financialNeed: { type: String, trim: true, maxlength: 4000, default: "" },

      status: {
        type: String,
        enum: ["submitted", "under_review", "shortlisted", "awarded", "rejected", "withdrawn"],
        default: "submitted",
        index: true,
      },

      adminNotes: { type: String, trim: true, maxlength: 2000, default: "" },

      // Documents
      transcript: { type: DocSchema, default: null },
      idDocument: { type: DocSchema, default: null },
      recommendationLetter: { type: DocSchema, default: null },
      otherDocs: { type: [DocSchema], default: [] },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  ScholarshipApplicationSchema.pre("validate", function (next) {
    if (this.applicationId) this.applicationId = String(this.applicationId).trim().toUpperCase();
    if (this.fullName) this.fullName = String(this.fullName).trim().replace(/\s+/g, " ");
    if (this.email) this.email = String(this.email).trim().toLowerCase();
    if (this.regNo) this.regNo = String(this.regNo).trim().replace(/\s+/g, " ");
    next();
  });

  ScholarshipApplicationSchema.index(
    { applicationId: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  ScholarshipApplicationSchema.index({ scholarship: 1, status: 1, createdAt: -1 });

  return connection.model("ScholarshipApplication", ScholarshipApplicationSchema);
};