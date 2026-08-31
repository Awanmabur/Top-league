const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("JobOpportunity model requires a mongoose connection");
  if (connection.models.JobOpportunity) return connection.models.JobOpportunity;

  const JobOpportunitySchema = new Schema({
    title: { type: String, required: true, trim: true, maxlength: 180 },
    employer: { type: String, required: true, trim: true, maxlength: 180 },
    type: { type: String, enum: ["Internship", "Part-time", "Full-time", "Contract", "Graduate Program", "Opportunity"], default: "Opportunity", index: true },
    location: { type: String, default: "", trim: true, maxlength: 180 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    requirements: { type: String, default: "", trim: true, maxlength: 3000 },
    externalApplyUrl: { type: String, default: "", trim: true, maxlength: 1000 },
    publishAt: { type: Date, default: null },
    deadline: { type: Date, default: null, index: true },
    status: { type: String, enum: ["Draft", "Published", "Closed", "Archived"], default: "Draft", index: true },
    eligibleClassLevels: { type: [String], default: [] },
    revision: { type: Number, default: 1, min: 1 },
    legacySourceId: { type: String, default: "", trim: true, maxlength: 180 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });

  JobOpportunitySchema.index({ status: 1, deadline: 1, publishAt: 1, isDeleted: 1, createdAt: -1 });
  JobOpportunitySchema.index({ type: 1, status: 1, isDeleted: 1 });
  JobOpportunitySchema.index({ legacySourceId: 1 }, { unique: true, sparse: true });
  return connection.model("JobOpportunity", JobOpportunitySchema);
};
