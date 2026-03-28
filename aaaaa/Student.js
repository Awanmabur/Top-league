const { Schema } = require("mongoose");

module.exports = (connection) => {
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
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
  ];

  const StudentSchema = new Schema(
    {
      // ===== Identity =====
      fullName: { type: String, trim: true, maxlength: 120 },
      firstName: { type: String, trim: true, maxlength: 60 },
      middleName: { type: String, trim: true, maxlength: 60 },
      lastName: { type: String, trim: true, maxlength: 60 },

      // ===== Registration IDs =====
      regNo: { type: String, required: true, trim: true, maxlength: 60 },
      studentNo: { type: String, trim: true, maxlength: 60 },
      indexNumber: { type: String, trim: true, maxlength: 60 },

      // ===== Contacts =====
      email: { type: String, trim: true, lowercase: true, maxlength: 120 },
      phone: { type: String, trim: true, maxlength: 40 },

      // ===== Academy Academic Setup =====
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

      subjects: [
        {
          type: Schema.Types.ObjectId,
          ref: "Subject",
        },
      ],

      academicYear: { type: String, trim: true, maxlength: 20 },
      term: { type: Number, min: 1, max: 3, default: 1, index: true },

      financeBalance: { type: Number, default: 0 },

      // ===== Status & Holds =====
      status: {
        type: String,
        enum: ["active", "on_hold", "suspended", "graduated", "archived"],
        default: "active",
        index: true,
      },

      holdType: { type: String, trim: true, maxlength: 60 },
      holdReason: { type: String, trim: true, maxlength: 200 },
      holdUntil: { type: Date },

      // ===== Optional profile =====
      gender: { type: String, trim: true, maxlength: 30 },
      dob: { type: Date },
      nationality: { type: String, trim: true, maxlength: 60 },
      address: { type: String, trim: true, maxlength: 200 },

      guardianName: { type: String, trim: true, maxlength: 120 },
      guardianPhone: { type: String, trim: true, maxlength: 40 },
      guardianEmail: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 120,
      },

      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },
      guardianUserId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },

      photoUrl: { type: String, trim: true, maxlength: 500 },

      // ===== Soft delete / audit =====
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  StudentSchema.pre("validate", function (next) {
    if (this.regNo) this.regNo = String(this.regNo).trim().replace(/\s+/g, " ");
    if (this.email) this.email = String(this.email).trim().toLowerCase();

    if (!this.fullName) {
      const built = [this.firstName, this.middleName, this.lastName]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (built) this.fullName = built;
    }

    if (this.fullName) {
      this.fullName = String(this.fullName).trim().replace(/\s+/g, " ");
    }

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
      partialFilterExpression: { isDeleted: { $ne: true } },
    }
  );

  StudentSchema.index({ fullName: 1 });
  StudentSchema.index({ email: 1 });
  StudentSchema.index({ schoolLevel: 1, classLevel: 1, term: 1, status: 1 });
  StudentSchema.index({ createdAt: -1 });

  StudentSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.status = "archived";
    await this.save();
  };

  return connection.model("Student", StudentSchema);
};