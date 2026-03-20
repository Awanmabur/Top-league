// src/models/tenant/Intake.js
module.exports = (conn) => {
  const mongoose = require("mongoose");

  if (!conn) throw new Error("Tenant connection is required for Intake model");
  if (conn.models.Intake) return conn.models.Intake;

  const IntakeProgramSchema = new mongoose.Schema(
    {
      program: { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true, index: true },
      capacity: { type: Number, default: 0 },
      isOpen: { type: Boolean, default: true },
      notes: { type: String, default: "" },
    },
    { _id: false }
  );

  const IntakeSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, index: true }, // e.g. "January 2026 Intake"
      code: { type: String, required: true, trim: true, uppercase: true }, // e.g. "JAN-2026"
      year: { type: Number, default: null },
      term: { type: String, default: "" }, // e.g. "Term 1" or "Semester 1"

      status: { type: String, enum: ["draft", "open", "closed", "archived"], default: "draft", index: true },
      isActive: { type: Boolean, default: false, index: true }, // only one active intake recommended

      applicationOpenDate: { type: Date, default: null },
      applicationCloseDate: { type: Date, default: null },
      startDate: { type: Date, default: null }, // classes start
      endDate: { type: Date, default: null },

      programs: { type: [IntakeProgramSchema], default: [] },

      notes: { type: String, default: "" },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  // Unique code per tenant DB
  IntakeSchema.index({ code: 1 }, { unique: true });

  return conn.model("Intake", IntakeSchema);
};