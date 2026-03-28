const { Schema } = require("mongoose");

const LEVEL_TYPES = ["nursery", "primary", "secondary"];
const CATEGORIES = ["core", "practical", "language", "religious", "co-curricular", "general"];
const STATUSES = ["active", "draft", "archived"];

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function normalizeText(value, max) {
  return String(value || "").trim().slice(0, max);
}

module.exports = (connection) => {
  if (!connection) throw new Error("Subject model requires a mongoose connection");
  if (connection.models.Subject) return connection.models.Subject;

  const SubjectSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 180 },
      code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 40 },
      shortTitle: { type: String, default: "", trim: true, maxlength: 80 },

      schoolUnitId: { type: String, required: true, trim: true, index: true },
      schoolUnitName: { type: String, required: true, trim: true, maxlength: 180 },
      schoolUnitCode: { type: String, default: "", trim: true, maxlength: 40 },

      campusId: { type: String, required: true, trim: true, index: true },
      campusName: { type: String, required: true, trim: true, maxlength: 180 },
      campusCode: { type: String, default: "", trim: true, maxlength: 40 },

      levelType: { type: String, enum: LEVEL_TYPES, required: true, index: true },

      classId: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },
      className: { type: String, default: "", trim: true, maxlength: 180 },
      classCode: { type: String, default: "", trim: true, maxlength: 40 },
      classLevel: { type: String, default: "", trim: true, uppercase: true, maxlength: 20, index: true },
      classStream: { type: String, default: "", trim: true, uppercase: true, maxlength: 20, index: true },

      sectionId: { type: String, default: "", trim: true, index: true },
      sectionName: { type: String, default: "", trim: true, maxlength: 80 },
      sectionCode: { type: String, default: "", trim: true, maxlength: 40 },

      term: { type: Number, default: 1, min: 1, max: 3, index: true },
      academicYear: { type: String, default: "", trim: true, maxlength: 20, index: true },

      category: { type: String, enum: CATEGORIES, default: "core", index: true },
      isCompulsory: { type: Boolean, default: true, index: true },
      weeklyPeriods: { type: Number, default: 0, min: 0, max: 50 },
      passMark: { type: Number, default: 0, min: 0, max: 100 },
      assessmentMethod: { type: String, default: "", trim: true, maxlength: 500 },

      teacher: { type: Schema.Types.ObjectId, ref: "Staff", default: null, index: true },

      status: { type: String, enum: STATUSES, default: "active", index: true },
      description: { type: String, default: "", trim: true, maxlength: 1200 },
      objectives: { type: String, default: "", trim: true, maxlength: 1200 },
      outline: { type: String, default: "", trim: true, maxlength: 5000 },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  SubjectSchema.pre("validate", function normalizeSubject(next) {
    this.title = normalizeText(this.title, 180);
    this.shortTitle = normalizeText(this.shortTitle, 80);
    this.code = normalizeCode(this.code);
    this.schoolUnitCode = normalizeCode(this.schoolUnitCode);
    this.campusCode = normalizeCode(this.campusCode);
    this.classCode = normalizeCode(this.classCode);
    this.sectionCode = normalizeCode(this.sectionCode);
    this.classLevel = String(this.classLevel || "").trim().toUpperCase();
    this.classStream = String(this.classStream || "").trim().toUpperCase();
    this.assessmentMethod = normalizeText(this.assessmentMethod, 500);
    this.description = normalizeText(this.description, 1200);
    this.objectives = normalizeText(this.objectives, 1200);
    this.outline = normalizeText(this.outline, 5000);
    next();
  });

  SubjectSchema.index({ code: 1 }, { unique: true });
  SubjectSchema.index({ campusId: 1, classId: 1, sectionId: 1, term: 1, academicYear: 1, status: 1 });
  SubjectSchema.index({ levelType: 1, classLevel: 1, category: 1 });
  SubjectSchema.index({ classId: 1, sectionId: 1, teacher: 1 });

  return connection.model("Subject", SubjectSchema);
};
