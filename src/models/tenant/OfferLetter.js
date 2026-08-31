module.exports = (conn) => {
  const mongoose = require("mongoose");
  const { Schema } = mongoose;

  if (!conn) throw new Error("Tenant connection is required for OfferLetter model");
  if (conn.models.OfferLetter) return conn.models.OfferLetter;

  const OfferLetterSchema = new Schema(
    {
      letterNo: { type: String, required: true, trim: true, maxlength: 40 },

      applicant: { type: Schema.Types.ObjectId, ref: "Applicant", required: true, index: true },
      program: { type: Schema.Types.ObjectId, ref: "Section", default: null, index: true },
      intakeId: { type: Schema.Types.ObjectId, ref: "Intake", default: null, index: true },

      template: { type: Schema.Types.ObjectId, ref: "OfferLetterTemplate", default: null, index: true },
      templateRevision: { type: Number, default: 1, min: 1 },

      subject: { type: String, required: true, trim: true, maxlength: 160 },
      bodyHtml: { type: String, required: true },
      contentHash: { type: String, trim: true, maxlength: 64, default: "" },
      snapshot: {
        applicantName: { type: String, trim: true, maxlength: 160, default: "" },
        email: { type: String, trim: true, lowercase: true, maxlength: 160, default: "" },
        phone: { type: String, trim: true, maxlength: 60, default: "" },
        sectionLabel: { type: String, trim: true, maxlength: 160, default: "" },
        intakeLabel: { type: String, trim: true, maxlength: 160, default: "" },
        academicYear: { type: String, trim: true, maxlength: 40, default: "" },
        studyMode: { type: String, trim: true, maxlength: 60, default: "" },
      },
      requirementsSnapshot: { type: [Schema.Types.Mixed], default: [] },

      status: { type: String, enum: ["draft", "sent", "void"], default: "draft", index: true },
      currentKey: { type: String, trim: true, maxlength: 90, default: null, index: true },
      revision: { type: Number, default: 1, min: 1 },

      deliveryStatus: { type: String, enum: ["not_sent", "sending", "sent", "failed"], default: "not_sent", index: true },
      sendClaimToken: { type: String, trim: true, maxlength: 80, default: "" },
      sendClaimAt: { type: Date, default: null },
      sendAttempts: { type: Number, default: 0, min: 0 },
      lastSendError: { type: String, trim: true, maxlength: 500, default: "" },
      providerMessageId: { type: String, trim: true, maxlength: 300, default: "" },

      issuedAt: { type: Date, default: null },
      issuedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      sentAt: { type: Date, default: null },
      sentBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      sentToEmail: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" },

      notes: { type: String, trim: true, maxlength: 600, default: "" },
      voidedAt: { type: Date, default: null },
      voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      voidReason: { type: String, trim: true, maxlength: 500, default: "" },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  OfferLetterSchema.index(
    { letterNo: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
  );
  OfferLetterSchema.index(
    { currentKey: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, currentKey: { $type: "string" } }, name: "one_current_offer_per_applicant_intake" }
  );

  return conn.model("OfferLetter", OfferLetterSchema);
};
