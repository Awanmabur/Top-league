// src/models/tenant/OfferLetterTemplate.js
module.exports = (conn) => {
  const mongoose = require("mongoose");
  const { Schema } = mongoose;

  if (!conn) throw new Error("Tenant connection is required for OfferLetterTemplate model");
  if (conn.models.OfferLetterTemplate) return conn.models.OfferLetterTemplate;

  const OfferLetterTemplateSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      isActive: { type: Boolean, default: true, index: true },

      subject: { type: String, required: true, trim: true, maxlength: 160 },
      bodyHtml: { type: String, required: true }, // HTML template with placeholders

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  return conn.model("OfferLetterTemplate", OfferLetterTemplateSchema);
};
