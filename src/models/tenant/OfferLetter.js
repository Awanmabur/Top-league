module.exports = (conn) => {
  const mongoose = require("mongoose");
  const { Schema } = mongoose;

  if (!conn) throw new Error("Tenant connection is required for OfferLetter model");
  if (conn.models.OfferLetter) return conn.models.OfferLetter;

  const OfferLetterSchema = new Schema(
    {
      letterNo: { type: String, required: true, trim: true, maxlength: 40 },

      applicant: { type: Schema.Types.ObjectId, ref: "Applicant", required: true, index: true },
      program: { type: Schema.Types.ObjectId, ref: "Program", default: null, index: true },
      intakeId: { type: Schema.Types.ObjectId, ref: "Intake", default: null, index: true },

      template: { type: Schema.Types.ObjectId, ref: "OfferLetterTemplate", default: null, index: true },

      subject: { type: String, required: true, trim: true, maxlength: 160 },
      bodyHtml: { type: String, required: true },

      status: { type: String, enum: ["draft", "sent", "void"], default: "draft", index: true },

      issuedAt: { type: Date, default: null },
      issuedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      sentAt: { type: Date, default: null },
      sentBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      sentToEmail: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" },

      notes: { type: String, trim: true, maxlength: 600, default: "" },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  OfferLetterSchema.index(
    { letterNo: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  return conn.model("OfferLetter", OfferLetterSchema);
};