const { Schema } = require("mongoose");

const LEVEL_TYPES = ["nursery", "primary", "secondary"];
const SHIFTS = ["day", "boarding", "both"];
const STATUSES = ["active", "inactive", "archived"];

const CLASS_LEVELS = [
  "BABY", "MIDDLE", "TOP",
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8",
  "S1", "S2", "S3", "S4", "S5", "S6",
];

const LEVEL_CLASS_MAP = {
  nursery: ["BABY", "MIDDLE", "TOP"],
  primary: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
  secondary: ["S1", "S2", "S3", "S4", "S5", "S6"],
};

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

function normalizeClassLevel(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeText(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

module.exports = (connection) => {
  if (!connection) throw new Error("Class model requires a mongoose connection");
  if (connection.models.Class) return connection.models.Class;

  const ClassSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 180 },
      code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 40 },

      schoolUnitId: { type: String, required: true, trim: true, index: true },
      schoolUnitName: { type: String, required: true, trim: true, maxlength: 180 },
      schoolUnitCode: { type: String, default: "", trim: true, maxlength: 40 },

      campusId: { type: String, required: true, trim: true, index: true },
      campusName: { type: String, required: true, trim: true, maxlength: 180 },
      campusCode: { type: String, default: "", trim: true, maxlength: 40 },

      levelId: { type: String, default: "", trim: true, index: true },
      levelName: { type: String, default: "", trim: true, maxlength: 80 },
      levelType: { type: String, enum: LEVEL_TYPES, required: true, index: true },

      classLevel: {
        type: String,
        required: true,
        enum: CLASS_LEVELS,
        uppercase: true,
        trim: true,
        index: true,
      },

      // Keep legacy stream for compatibility, while storing Section and Stream separately.
      sectionId: {
        type: Schema.Types.ObjectId,
        ref: "Section",
        default: null,
        index: true,
        sparse: true,
      },
      sectionName: { type: String, default: "", trim: true, maxlength: 100, index: true },
      sectionCode: { type: String, default: "", trim: true, maxlength: 40 },
      streamId: {
        type: Schema.Types.ObjectId,
        ref: "Stream",
        default: null,
        index: true,
        sparse: true,
      },
      streamName: { type: String, default: "", trim: true, maxlength: 100, index: true },
      streamCode: { type: String, default: "", trim: true, maxlength: 40 },
      stream: { type: String, default: "", trim: true, maxlength: 100, index: true },

      term: { type: Number, default: 1, min: 1, max: 3, index: true },
      academicYear: { type: String, default: "", trim: true, maxlength: 20, index: true },

      classTeacher: {
        type: Schema.Types.ObjectId,
        ref: "Staff",
        default: null,
        index: true,
      },

      shift: { type: String, enum: SHIFTS, default: "day", index: true },
      capacity: { type: Number, default: 0, min: 0, max: 100000 },
      enrolledCount: { type: Number, default: 0, min: 0, max: 100000 },
      room: { type: String, default: "", trim: true, maxlength: 80 },

      status: { type: String, enum: STATUSES, default: "active", index: true },
      description: { type: String, default: "", trim: true, maxlength: 1200 },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  ClassSchema.pre("validate", function normalizeClass(next) {
    this.name = normalizeText(this.name, 180);
    this.code = normalizeCode(this.code);
    this.schoolUnitName = normalizeText(this.schoolUnitName, 180);
    this.schoolUnitCode = normalizeCode(this.schoolUnitCode);
    this.campusName = normalizeText(this.campusName, 180);
    this.campusCode = normalizeCode(this.campusCode);
    this.levelName = normalizeText(this.levelName, 80);
    this.classLevel = normalizeClassLevel(this.classLevel);
    this.sectionName = normalizeText(this.sectionName, 100);
    this.sectionCode = normalizeCode(this.sectionCode);
    this.streamName = normalizeText(this.streamName, 100);
    this.streamCode = normalizeCode(this.streamCode);
    this.stream = normalizeText(this.stream, 100).toUpperCase();
    this.academicYear = normalizeText(this.academicYear, 20);
    this.room = normalizeText(this.room, 80);
    this.description = normalizeText(this.description, 1200);

    const allowed = LEVEL_CLASS_MAP[this.levelType] || [];
    if (this.classLevel && allowed.length && !allowed.includes(this.classLevel)) {
      return next(new Error("Class level does not match the selected level."));
    }
    next();
  });

  ClassSchema.index(
    { schoolUnitId: 1, campusId: 1, levelType: 1, classLevel: 1, sectionId: 1, streamId: 1, academicYear: 1, term: 1 },
    { unique: true, sparse: true }
  );
  ClassSchema.index({ campusId: 1, status: 1, classLevel: 1 });
  ClassSchema.index({ levelType: 1, classLevel: 1, sectionName: 1, streamName: 1 });
  ClassSchema.index({ academicYear: 1, term: 1 });

  return connection.model("Class", ClassSchema);
};
