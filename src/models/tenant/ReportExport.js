const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.ReportExport) return connection.models.ReportExport;

  const ReportExportSchema = new Schema(
    {
      // what was exported
      type: {
        type: String,
        enum: ["finance_summary", "invoices", "payments", "admissions", "students_outstanding"],
        required: true,
        index: true,
      },
      format: { type: String, enum: ["csv"], default: "csv", index: true },

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

      status: { type: String, enum: ["ready", "failed"], default: "ready", index: true },
      errorMessage: { type: String, trim: true, maxlength: 400 },

      // audit
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  // helpful index
  ReportExportSchema.index({ createdAt: -1 });

  ReportExportSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("ReportExport", ReportExportSchema);
};
