const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("Student model requires a mongoose connection");
  if (connection.models.Student) return connection.models.Student;

  const CLASS_LEVELS = [
    "BABY",
    "MIDDLE",
    "TOP",
    "P1",
    "P2",
    "P3",
    "P4",
    "P5",
    "P6",
    "P7",
    "P8",
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
  ];

  const StudentSchema = new Schema(
    {
      fullName: { type: String, trim: true, maxlength: 120 },
      firstName: { type: String, trim: true, maxlength: 60 },
      middleName: { type: String, trim: true, maxlength: 60 },
      lastName: { type: String, trim: true, maxlength: 60 },

      regNo: { type: String, required: true, trim: true, maxlength: 60 },
      studentNo: { type: String, trim: true, maxlength: 60 },
      indexNumber: { type: String, trim: true, maxlength: 60 },

      email: { type: String, trim: true, lowercase: true, maxlength: 120 },
      phone: { type: String, trim: true, maxlength: 40 },

      schoolUnitId: { type: String, trim: true, maxlength: 80, index: true },
      schoolUnitName: { type: String, trim: true, maxlength: 180 },
      schoolUnitCode: { type: String, trim: true, maxlength: 40 },

      campusId: { type: String, trim: true, maxlength: 80, index: true },
      campusName: { type: String, trim: true, maxlength: 180 },
      campusCode: { type: String, trim: true, maxlength: 40 },

      classId: { type: String, trim: true, maxlength: 80, index: true },
      className: { type: String, trim: true, maxlength: 180 },
      classCode: { type: String, trim: true, maxlength: 40 },

      section: { type: String, trim: true, maxlength: 40 },
      stream: { type: String, trim: true, maxlength: 40 },

      schoolLevel: {
        type: String,
        enum: ["nursery", "primary", "secondary"],
        required: true,
        index: true,
      },

      classLevel: {
        type: String,
        enum: CLASS_LEVELS,
        required: true,
        index: true,
      },

      subjects: [{ type: Schema.Types.ObjectId, ref: "Subject" }],

      academicYear: { type: String, trim: true, maxlength: 20 },
      term: { type: Number, min: 1, max: 3, default: 1, index: true },

      financeBalance: { type: Number, default: 0 },

      status: {
        type: String,
        enum: ["active", "on_hold", "suspended", "graduated", "archived"],
        default: "active",
        index: true,
      },

      holdType: { type: String, trim: true, maxlength: 60 },
      holdReason: { type: String, trim: true, maxlength: 200 },
      holdUntil: { type: Date },

      gender: { type: String, trim: true, maxlength: 30 },
      dob: { type: Date },
      nationality: { type: String, trim: true, maxlength: 60 },
      address: { type: String, trim: true, maxlength: 200 },

      guardianName: { type: String, trim: true, maxlength: 120 },
      guardianPhone: { type: String, trim: true, maxlength: 40 },
      guardianEmail: { type: String, trim: true, lowercase: true, maxlength: 120 },

      userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
      guardianUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },

      photoUrl: { type: String, trim: true, maxlength: 500 },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  StudentSchema.pre("validate", function (next) {
    const tidy = (v) => String(v || "").trim().replace(/\s+/g, " ");
    if (this.regNo) this.regNo = tidy(this.regNo);
    if (this.studentNo) this.studentNo = tidy(this.studentNo);
    if (this.indexNumber) this.indexNumber = tidy(this.indexNumber);
    if (this.email) this.email = tidy(this.email).toLowerCase();
    if (this.guardianEmail) this.guardianEmail = tidy(this.guardianEmail).toLowerCase();

    if (!this.fullName) {
      const built = [this.firstName, this.middleName, this.lastName]
        .map((x) => tidy(x))
        .filter(Boolean)
        .join(" ")
        .trim();
      if (built) this.fullName = built;
    }

    if (this.fullName) this.fullName = tidy(this.fullName);
    if (this.className) this.className = tidy(this.className);
    if (this.schoolUnitName) this.schoolUnitName = tidy(this.schoolUnitName);
    if (this.campusName) this.campusName = tidy(this.campusName);
    if (!this.section && this.stream) this.section = tidy(this.stream);

    next();
  });

  StudentSchema.index(
    { studentNo: 1 },
    {
      unique: true,
      partialFilterExpression: {
        isDeleted: { $ne: true },
        studentNo: { $exists: true, $type: "string", $ne: "" },
      },
    }
  );

  StudentSchema.index(
    { regNo: 1 },
    {
      unique: true,
      partialFilterExpression: {
        isDeleted: { $ne: true },
        regNo: { $exists: true, $type: "string", $ne: "" },
      },
    }
  );

  StudentSchema.index({ fullName: 1 });
  StudentSchema.index({ email: 1 });
  StudentSchema.index({ schoolUnitId: 1, campusId: 1, schoolLevel: 1, classLevel: 1, term: 1, status: 1 });
  StudentSchema.index({ classId: 1, section: 1 });
  StudentSchema.index({ createdAt: -1 });

  StudentSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.status = "archived";
    await this.save();
  };

  return connection.model("Student", StudentSchema);
};