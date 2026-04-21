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
      schoolLevel: {
        type: String,
        enum: ["nursery", "primary", "secondary", ""],
        default: "",
        trim: true,
        lowercase: true,
        index: true,
      },
      classLevel: { type: String, default: "", trim: true, uppercase: true, maxlength: 30, index: true },
      term: { type: Number, min: 1, max: 3, default: 1, index: true },
      intakeId: { type: Schema.Types.ObjectId, ref: "Intake", default: null, index: true },
      streamId: { type: Schema.Types.ObjectId, ref: "Stream", default: null, index: true },
      streamName: { type: String, trim: true, maxlength: 100, default: "" },

      // Legacy university-era fields kept optional so older documents still load.
      semester: { type: Number, min: 0, max: 6, default: 1 },
      yearLevel: { type: String, default: "", trim: true, maxlength: 30 },
      intake: { type: String, default: "General", trim: true, maxlength: 40 },
      studyMode: { type: String, default: "day", trim: true, maxlength: 40 },

      section1: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },
      section2: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },

      // Legacy field names, now pointing at Section to avoid breaking old records/routes.
      program1: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },
      program2: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },

      preferredClassGroup: { type: Schema.Types.ObjectId, ref: "Class", default: null, index: true },

      qualification: { type: String, required: true, trim: true, maxlength: 60 },
      school: { type: String, required: true, trim: true, maxlength: 120 },
      yearCompleted: { type: Number, required: true, min: 1900, max: 2100 },
      grades: { type: String, trim: true, maxlength: 160 },

      notes: { type: String, trim: true, maxlength: 600 },

      passportPhoto: { type: DocSchema, default: null },
      idDocument: { type: DocSchema, default: null },
      transcript: { type: DocSchema, default: null },
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
      adminNotes: { type: String, trim: true, maxlength: 1200, default: "" },
      tags: { type: [String], default: [] },
      interviewStatus: { type: String, trim: true, maxlength: 60, default: "" },
      interviewWhen: { type: Date, default: null },
      interviewMode: { type: String, trim: true, maxlength: 40, default: "" },
      interviewPanel: { type: String, trim: true, maxlength: 200, default: "" },
      requestedDocs: {
        type: [
          {
            missingKeys: { type: [String], default: [] },
            via: { type: String, trim: true, maxlength: 20, default: "email" },
            deadline: { type: Date, default: null },
            message: { type: String, trim: true, maxlength: 1200, default: "" },
            requestedAt: { type: Date, default: Date.now },
            requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
          },
        ],
        default: [],
      },

      linkedStudent: { type: Schema.Types.ObjectId, ref: "Student", default: null, index: true },
      convertedStudentId: { type: Schema.Types.ObjectId, ref: "Student", default: null, index: true },
      regNo: { type: String, trim: true, maxlength: 60 },

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
    if (this.classLevel) this.classLevel = String(this.classLevel).trim().toUpperCase();
    if (this.yearLevel && !this.classLevel) this.classLevel = String(this.yearLevel).trim().toUpperCase();
    if (this.classLevel && !this.yearLevel) this.yearLevel = this.classLevel;
    if (this.schoolLevel) this.schoolLevel = String(this.schoolLevel).trim().toLowerCase();
    if (this.term && !this.semester) this.semester = this.term;
    if (this.semester && !this.term && Number(this.semester) >= 1 && Number(this.semester) <= 3) {
      this.term = Number(this.semester);
    }
    if (this.streamName) this.streamName = String(this.streamName).trim();
    if (!this.section1 && this.program1) this.section1 = this.program1;
    if (!this.program1 && this.section1) this.program1 = this.section1;
    if (!this.section2 && this.program2) this.section2 = this.program2;
    if (!this.program2 && this.section2) this.program2 = this.section2;
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
