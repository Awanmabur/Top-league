// src/models/tenant/AdmissionRequirement.js
module.exports = (conn) => {
  const mongoose = require("mongoose");
  const { Schema } = mongoose;

  if (!conn) throw new Error("Tenant connection is required for AdmissionRequirement model");
  if (conn.models.AdmissionRequirement) return conn.models.AdmissionRequirement;

  const AdmissionRequirementSchema = new Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 120, index: true },
      code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },

      category: {
        type: String,
        enum: ["document", "fee", "exam", "medical", "other"],
        default: "document",
        index: true,
      },

      description: { type: String, trim: true, maxlength: 700, default: "" },

      appliesToAllPrograms: { type: Boolean, default: true, index: true },
      programs: { type: [Schema.Types.ObjectId], ref: "Program", default: [], index: true },

      appliesToAllIntakes: { type: Boolean, default: true, index: true },
      intakes: { type: [Schema.Types.ObjectId], ref: "Intake", default: [], index: true },

      isMandatory: { type: Boolean, default: true, index: true },
      isActive: { type: Boolean, default: true, index: true },

      sortOrder: { type: Number, default: 0 },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  AdmissionRequirementSchema.index(
    { code: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  AdmissionRequirementSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return conn.model("AdmissionRequirement", AdmissionRequirementSchema);
};