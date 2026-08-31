const mongoose = require("mongoose");

module.exports = function BackupJobModel(conn) {
  if (!conn) throw new Error("BackupJob model requires a DB connection");

  const RestoreHistorySchema = new mongoose.Schema(
    {
      actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      actorName: { type: String, trim: true, default: "" },
      scope: { type: String, trim: true, default: "" },
      status: {
        type: String,
        enum: ["Pending", "Completed", "Failed"],
        default: "Pending",
      },
      note: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const BackupJobSchema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 220 },
      type: {
        type: String,
        enum: ["Manual", "Scheduled"],
        default: "Manual",
      },
      scope: {
        type: String,
        enum: ["Full System", "Config Only"],
        default: "Full System",
      },
      storage: {
        type: String,
        enum: ["Cloudinary"],
        default: "Cloudinary",
      },
      retentionDays: { type: Number, default: 30, min: 1 },
      scheduleAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["Completed", "Running", "Scheduled", "Failed", "Restoring", "Archived"],
        default: "Scheduled",
      },
      notes: { type: String, trim: true, default: "" },
      sizeBytes: { type: Number, default: 0 },
      sizeLabel: { type: String, trim: true, default: "0.00 GB" },
      checksum: { type: String, trim: true, default: "" },
      plainHash: { type: String, trim: true, default: "" },
      filePath: { type: String, trim: true, default: "" },
      filePublicId: { type: String, trim: true, default: "" },
      fileResourceType: { type: String, trim: true, default: "raw" },
      accessType: { type: String, enum: ["authenticated", "legacy", "missing"], default: "missing" },
      artifactVersion: { type: Number, default: 1 },
      completedAt: { type: Date, default: null },
      failedAt: { type: Date, default: null },
      failureReason: { type: String, trim: true, maxlength: 500, default: "" },
      revision: { type: Number, default: 1, min: 1 },
      restoreLockUntil: { type: Date, default: null },
      migrationQuarantinedAt: { type: Date, default: null },
      migrationQuarantineReason: { type: String, trim: true, maxlength: 300, default: "" },
      restoreHistory: { type: [RestoreHistorySchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  BackupJobSchema.index({ createdAt: -1 });
  BackupJobSchema.index({ status: 1, type: 1, storage: 1, createdAt: -1 });
  BackupJobSchema.index({ scheduleAt: 1, status: 1, isDeleted: 1 });
  BackupJobSchema.index({ checksum: 1 }, { sparse: true });

  return conn.models.BackupJob || conn.model("BackupJob", BackupJobSchema);
};