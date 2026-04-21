const { Schema } = require("mongoose");

const STATUSES = ["active", "inactive", "archived"];

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

module.exports = (connection) => {
  if (!connection) throw new Error("Stream model requires a mongoose connection");
  if (connection.models.Stream) return connection.models.Stream;

  const StreamSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 100 },
      code: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 40 },

      schoolUnitId: { type: String, required: true, trim: true, index: true },
      schoolUnitName: { type: String, required: true, trim: true, maxlength: 180 },
      schoolUnitCode: { type: String, default: "", trim: true, maxlength: 40 },

      campusId: { type: String, required: true, trim: true, index: true },
      campusName: { type: String, required: true, trim: true, maxlength: 180 },
      campusCode: { type: String, default: "", trim: true, maxlength: 40 },

      levelType: { type: String, enum: ["nursery", "primary", "secondary"], required: true, index: true },

      classId: { type: Schema.Types.ObjectId, ref: "Class", required: true, index: true },
      className: { type: String, default: "", trim: true, maxlength: 180 },
      classCode: { type: String, default: "", trim: true, maxlength: 40 },
      classLevel: { type: String, default: "", trim: true, uppercase: true, maxlength: 20, index: true },
      classStream: { type: String, default: "", trim: true, uppercase: true, maxlength: 20, index: true },

      sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true, sparse: true },
      sectionName: { type: String, default: "", trim: true, maxlength: 100, index: true },
      sectionCode: { type: String, default: "", trim: true, maxlength: 40 },

      classTeacher: { type: Schema.Types.ObjectId, ref: "Staff", default: null, index: true },
      room: { type: String, default: "", trim: true, maxlength: 80 },
      capacity: { type: Number, default: 0, min: 0, max: 100000 },
      enrolledCount: { type: Number, default: 0, min: 0, max: 100000 },

      status: { type: String, enum: STATUSES, default: "active", index: true },
      notes: { type: String, default: "", trim: true, maxlength: 1200 },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  StreamSchema.pre("validate", function normalizeStream(next) {
    this.code = normalizeCode(this.code);
    this.schoolUnitCode = normalizeCode(this.schoolUnitCode);
    this.campusCode = normalizeCode(this.campusCode);
    this.classCode = normalizeCode(this.classCode);
    this.classLevel = String(this.classLevel || "").trim().toUpperCase();
    this.classStream = String(this.classStream || "").trim().toUpperCase();
    this.sectionCode = normalizeCode(this.sectionCode);
    next();
  });

  StreamSchema.index({ code: 1 }, { unique: true });
  StreamSchema.index({ classId: 1, sectionId: 1, name: 1 }, { unique: true });
  StreamSchema.index({ campusId: 1, classId: 1, status: 1 });
  StreamSchema.index({ levelType: 1, classLevel: 1, classStream: 1, sectionId: 1 });

  return connection.model("Stream", StreamSchema);
};
