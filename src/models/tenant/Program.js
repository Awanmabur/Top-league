const mongoose = require("mongoose");

const STATUSES = ["active", "inactive", "archived"];
const LEVEL_TYPES = ["nursery", "primary", "secondary", "mixed", "other"];

function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function code(value, fallback = "") {
  const out = String(value || fallback || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  return out;
}

module.exports = function ProgramModel(conn) {
  if (!conn) throw new Error("Program model requires a DB connection");
  if (conn.models.Program) return conn.models.Program;

  const ProgramSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 180 },
      title: { type: String, trim: true, default: "", maxlength: 180 },
      shortTitle: { type: String, trim: true, default: "", maxlength: 80 },
      code: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },

      schoolUnitId: { type: String, trim: true, default: "", maxlength: 80, index: true },
      schoolUnitName: { type: String, trim: true, default: "", maxlength: 180 },
      schoolUnitCode: { type: String, trim: true, default: "", maxlength: 48 },
      levelType: { type: String, enum: LEVEL_TYPES, default: "mixed", index: true },
      classLevels: { type: [String], default: [] },

      status: { type: String, enum: STATUSES, default: "active", index: true },
      description: { type: String, trim: true, default: "", maxlength: 2000 },

      // A Program row may be a compatibility projection of a historical Subject
      // that was previously (and incorrectly) used as a finance "program".
      legacySubjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", default: null },
      migrationQuarantinedAt: { type: Date, default: null },
      migrationReason: { type: String, trim: true, default: "", maxlength: 300 },

      revision: { type: Number, default: 1, min: 1 },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  ProgramSchema.pre("validate", function normalizeProgram(next) {
    this.name = text(this.name || this.title, 180);
    this.title = text(this.title || this.name, 180);
    this.shortTitle = text(this.shortTitle, 80);
    this.code = code(this.code, this.shortTitle || this.name);
    this.schoolUnitId = text(this.schoolUnitId, 80);
    this.schoolUnitName = text(this.schoolUnitName, 180);
    this.schoolUnitCode = code(this.schoolUnitCode);
    this.description = text(this.description, 2000);
    this.classLevels = [...new Set((Array.isArray(this.classLevels) ? this.classLevels : [])
      .map((v) => text(v, 20).toUpperCase())
      .filter(Boolean))].slice(0, 30);
    if (!this.name) this.invalidate("name", "Program name is required.");
    if (!this.code) this.invalidate("code", "Program code is required.");
    next();
  });

  ProgramSchema.index(
    { code: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
  );
  ProgramSchema.index(
    { legacySubjectId: 1 },
    { name: "uniq_program_legacy_subject", unique: true, partialFilterExpression: { legacySubjectId: { $type: "objectId" } } }
  );
  ProgramSchema.index({ isDeleted: 1, status: 1, schoolUnitId: 1, name: 1 });

  return conn.model("Program", ProgramSchema);
};
