const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Applicant) return connection.models.Applicant;

  const DocSchema = new Schema(
    {
      url: { type: String, required: true, trim: true, maxlength: 800 },
      publicId: { type: String, required: true, trim: true, maxlength: 300 },
      resourceType: { type: String, trim: true, maxlength: 20, default: "auto" },
      originalName: { type: String, trim: true, maxlength: 200 },
      bytes: { type: Number, default: 0 },
      mimeType: { type: String, trim: true, maxlength: 80 },
    },
    { _id: false }
  );

  const ApplicantSchema = new Schema(
    {
      applicationId: { type: String, required: true, trim: true, maxlength: 60 },

      fullName: { type: String, trim: true, maxlength: 120 },
      firstName: { type: String, required: true, trim: true, maxlength: 60 },
      middleName: { type: String, trim: true, maxlength: 60 },
      lastName: { type: String, required: true, trim: true, maxlength: 60 },

      gender: { type: String, required: true, trim: true, maxlength: 30 },
      dob: { type: Date, required: true },
      nationality: { type: String, required: true, trim: true, maxlength: 60 },
      address: { type: String, required: true, trim: true, maxlength: 200 },

      email: { type: String, required: true, trim: true, lowercase: true, maxlength: 120, index: true },
      phone: { type: String, required: true, trim: true, maxlength: 40, index: true },

      guardianName: { type: String, required: true, trim: true, maxlength: 120 },
      guardianPhone: { type: String, required: true, trim: true, maxlength: 40 },
      guardianEmail: { type: String, trim: true, lowercase: true, maxlength: 120 },

      academicYear: { type: String, required: true, trim: true, maxlength: 20 },
      semester: { type: Number, min: 0, max: 6, default: 1 },
      yearLevel: { type: String, required: true, trim: true, maxlength: 30 },
      intake: { type: String, required: true, trim: true, maxlength: 40 },
      studyMode: { type: String, required: true, trim: true, maxlength: 40 },

      program1: { type: Schema.Types.ObjectId, ref: "Program", required: true, index: true },
      program2: { type: Schema.Types.ObjectId, ref: "Program", default: null, index: true },

      preferredClassGroup: { type: Schema.Types.ObjectId, ref: "Class", default: null, index: true },

      qualification: { type: String, required: true, trim: true, maxlength: 60 },
      school: { type: String, required: true, trim: true, maxlength: 120 },
      yearCompleted: { type: Number, required: true, min: 1900, max: 2100 },
      grades: { type: String, trim: true, maxlength: 160 },

      notes: { type: String, trim: true, maxlength: 600 },

      passportPhoto: { type: DocSchema, required: true },
      idDocument: { type: DocSchema, required: true },
      transcript: { type: DocSchema, required: true },
      otherDocs: { type: [DocSchema], default: [] },

      status: {
        type: String,
        enum: ["submitted", "under_review", "accepted", "rejected", "converted"],
        default: "submitted",
        index: true,
      },

      decidedAt: { type: Date, default: null },
      decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      decisionNote: { type: String, trim: true, maxlength: 400 },

      linkedStudent: { type: Schema.Types.ObjectId, ref: "Student", default: null, index: true },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
    },
    { timestamps: true }
  );

  ApplicantSchema.pre("validate", function (next) {
    if (this.email) this.email = String(this.email).trim().toLowerCase();
    if (this.phone) this.phone = String(this.phone).trim();
    if (!this.fullName) {
      const built = [this.firstName, this.middleName, this.lastName]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (built) this.fullName = built;
    }
    if (this.fullName) this.fullName = String(this.fullName).trim().replace(/\s+/g, " ");
    next();
  });

  ApplicantSchema.index(
    { applicationId: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  ApplicantSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("Applicant", ApplicantSchema);
};