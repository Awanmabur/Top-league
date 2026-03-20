const mongoose = require("mongoose");

module.exports = function TenantProfileModel(conn) {
  if (!conn) throw new Error("TenantProfile model requires a DB connection");

  const TenantProfileSchema = new mongoose.Schema(
    {
      schoolName: { type: String, required: true, trim: true, maxlength: 220 },
      shortName: { type: String, trim: true, default: "" },
      tagline: { type: String, trim: true, default: "" },
      category: { type: String, trim: true, default: "" },

      email: { type: String, trim: true, lowercase: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      altPhone: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      website: { type: String, trim: true, default: "" },

      logoUrl: { type: String, trim: true, default: "" },
      faviconUrl: { type: String, trim: true, default: "" },
      primaryColor: { type: String, trim: true, default: "#0a6fbf" },
      secondaryColor: { type: String, trim: true, default: "#0d4060" },
      motto: { type: String, trim: true, default: "" },
      description: { type: String, trim: true, default: "" },

      tenantCode: { type: String, trim: true, default: "" },
      planName: { type: String, trim: true, default: "Starter" },
      subscriptionStatus: { type: String, trim: true, default: "Active" },
      billingEmail: { type: String, trim: true, lowercase: true, default: "" },

      subdomain: { type: String, trim: true, default: "" },
      customDomain: { type: String, trim: true, default: "" },
      domainStatus: { type: String, trim: true, default: "Pending" },
      sslStatus: { type: String, trim: true, default: "Pending" },

      status: { type: String, trim: true, default: "Active" },
      studentCount: { type: Number, default: 0 },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  TenantProfileSchema.index({ createdAt: -1 });
  TenantProfileSchema.index({ schoolName: 1 });
  TenantProfileSchema.index({ tenantCode: 1 });
  TenantProfileSchema.index({ subdomain: 1 });

  return conn.models.TenantProfile || conn.model("TenantProfile", TenantProfileSchema);
};