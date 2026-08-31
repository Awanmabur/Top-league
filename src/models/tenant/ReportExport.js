const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.ReportExport) return connection.models.ReportExport;

  const ReportExportSchema = new Schema(
    {
      // what was exported
      type: {
        type: String,
        enum: ["finance_summary", "invoices", "payments", "admissions", "students_outstanding", "analytics_summary"],
        required: true,
        index: true,
      },
      format: { type: String, enum: ["csv"], default: "csv", index: true },
      source: { type: String, enum: ["export", "import"], default: "export", index: true },
      originalFileName: { type: String, trim: true, maxlength: 180, default: "" },
      fileName: { type: String, trim: true, maxlength: 180, default: "" },
      contentType: { type: String, trim: true, maxlength: 120, default: "text/csv" },
      checksum: { type: String, trim: true, maxlength: 64, default: "" },
      accessType: { type: String, enum: ["authenticated", "legacy_public", "missing"], default: "authenticated" },

      // filters used
      filters: {
        type: Schema.Types.Mixed, // { from,to,academicYear,semester,status,program,... }
        default: {},
      },

      rowsCount: { type: Number, default: 0 },
      byteSize: { type: Number, default: 0 },

      // cloudinary file
      fileUrl: { type: String, trim: true, maxlength: 800 },
      filePublicId: { type: String, trim: true, maxlength: 300 },
      fileResourceType: { type: String, trim: true, maxlength: 40, default: "raw" },

      status: { type: String, enum: ["ready", "failed", "quarantined"], default: "ready", index: true },
      errorMessage: { type: String, trim: true, maxlength: 400 },

      // audit
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      revision: { type: Number, default: 1, min: 1 },
      migrationQuarantinedAt: { type: Date, default: null },
      migrationQuarantineReason: { type: String, trim: true, maxlength: 300, default: "" },
    },
    { timestamps: true }
  );

  ReportExportSchema.pre("validate", function (next) {
    if (this.status === "ready") {
      if (!this.filePublicId || this.accessType !== "authenticated") {
        return next(new Error("Ready report artifacts require authenticated storage."));
      }
      if (!/^[a-f0-9]{64}$/i.test(String(this.checksum || ""))) {
        return next(new Error("Ready report artifacts require a SHA-256 checksum."));
      }
      if (String(this.contentType || "").toLowerCase() !== "text/csv") {
        return next(new Error("Only CSV report artifacts are supported."));
      }
      this.fileUrl = "";
    }
    next();
  });

  // helpful index
  ReportExportSchema.index({ createdAt: -1 });
  ReportExportSchema.index({ isDeleted: 1, status: 1, createdAt: -1 });
  ReportExportSchema.index({ type: 1, source: 1, isDeleted: 1, createdAt: -1 });
  ReportExportSchema.index({ checksum: 1 }, { sparse: true });

  ReportExportSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("ReportExport", ReportExportSchema);
};
