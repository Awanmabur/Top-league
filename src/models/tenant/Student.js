const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Student) return connection.models.Student;

  const StudentSchema = new Schema(
    {
      // ===== Identity =====
      fullName: { type: String, trim: true, maxlength: 120 },
      firstName: { type: String, trim: true, maxlength: 60 },
      middleName: { type: String, trim: true, maxlength: 60 },
      lastName: { type: String, trim: true, maxlength: 60 },

      // ===== Registration IDs =====
      regNo: { type: String, required: true, trim: true, maxlength: 60 }, // REQUIRED
      studentNo: { type: String, trim: true, maxlength: 60 },
      indexNumber: { type: String, trim: true, maxlength: 60 },

      // ===== Contacts =====
      email: { type: String, trim: true, lowercase: true, maxlength: 120 },
      phone: { type: String, trim: true, maxlength: 40 },

      // ===== Academic links =====
      program: {
        type: Schema.Types.ObjectId,
        ref: "Program",
        required: true,
        index: true,
      },
      classGroup: {
        type: Schema.Types.ObjectId,
        ref: "Class",
        required: true,
        index: true,
      },
      department: {
        type: Schema.Types.ObjectId,
        ref: "Department",
        default: null,
        index: true,
      },
      faculty: {
        type: Schema.Types.ObjectId,
        ref: "Faculty",
        default: null,
        index: true,
      },

      yearLevel: { type: String, trim: true, maxlength: 30 }, // "Year 1"
      academicYear: { type: String, trim: true, maxlength: 20 }, // "2025/2026"
      semester: { type: Number, min: 0, max: 6, default: 1 },
      financeBalance: { type: Number, default: 0 }, // total outstanding

      // ===== Status & Holds =====
      status: {
        type: String,
        enum: ["active", "on_hold", "suspended", "graduated", "archived"],
        default: "active",
        index: true,
      },

      holdType: { type: String, trim: true, maxlength: 60 }, // e.g. "Exam Hold"
      holdReason: { type: String, trim: true, maxlength: 200 }, // e.g. "Outstanding balance"
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
    { timestamps: true },
  );

  // Build fullName if missing + normalize
  StudentSchema.pre("validate", function (next) {
    // Normalize regNo
    if (this.regNo) this.regNo = String(this.regNo).trim().replace(/\s+/g, " ");

    // Normalize email
    if (this.email) this.email = String(this.email).trim().toLowerCase();

    // Auto build fullName if not provided
    if (!this.fullName) {
      const built = [this.firstName, this.middleName, this.lastName]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (built) this.fullName = built;
    }

    // Normalize fullName
    if (this.fullName)
      this.fullName = String(this.fullName).trim().replace(/\s+/g, " ");

    next();
  });

  // Unique studentNo ONLY when it's a real value (ignore null/empty/missing)
  StudentSchema.index(
    { studentNo: 1 },
    {
      unique: true,
      partialFilterExpression: {
        isDeleted: { $ne: true },
        studentNo: { $exists: true, $type: "string", $ne: "" },
      },
    },
  );

  // ✅ DB-per-tenant unique regNo (soft-delete safe)
  StudentSchema.index(
    { regNo: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } },
  );

  // Helpful search/sort indexes
  StudentSchema.index({ fullName: 1 });
  StudentSchema.index({ email: 1 });
  StudentSchema.index({ program: 1, classGroup: 1, yearLevel: 1, status: 1 });
  StudentSchema.index({ createdAt: -1 });

  // Methods
  StudentSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.status = "archived";
    await this.save();
  };

  return connection.model("Student", StudentSchema);
};
