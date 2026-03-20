const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Transcript) return connection.models.Transcript;

  const TranscriptSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },

      kind: { type: String, enum: ["official", "unofficial"], default: "official", index: true },

      // Range filters (optional)
      academicYearFrom: { type: String, default: "", trim: true },
      academicYearTo: { type: String, default: "", trim: true },
      semesterFrom: { type: Number, default: 0, min: 0, max: 6 },
      semesterTo: { type: Number, default: 6, min: 0, max: 6 },

      includeDraftResults: { type: Boolean, default: false },

      status: { type: String, enum: ["draft", "issued", "revoked"], default: "draft", index: true },

      issueNumber: { type: String, default: "", trim: true, unique: true, sparse: true },
      issuedAt: { type: Date, default: null },
      issuedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      revokedAt: { type: Date, default: null },
      revokedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      revokeReason: { type: String, default: "", trim: true },

      // ✅ Immutable data after issue
      snapshot: { type: Object, default: null },
      snapshotHash: { type: String, default: "", trim: true },

      notes: { type: String, default: "", trim: true },
    },
    { timestamps: true }
  );

  TranscriptSchema.index({ student: 1, createdAt: -1 });

  return connection.model("Transcript", TranscriptSchema);
};