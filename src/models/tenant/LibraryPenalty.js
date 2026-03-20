const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryPenalty) return connection.models.LibraryPenalty;

  const LibraryPenaltySchema = new Schema(
    {
      borrowId: { type: Schema.Types.ObjectId, ref: "Borrow", required: true },
      studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
      amount: { type: Number, required: true },
      reason: { type: String, trim: true }, // Late, Lost, Damaged
      status: { type: String, enum: ["pending", "paid"], default: "pending" },
      recordedBy: { type: Schema.Types.ObjectId, ref: "Staff" },
    },
    { timestamps: true }
  );

  LibraryPenaltySchema.index({ studentId: 1 });

  return connection.model("LibraryPenalty", LibraryPenaltySchema);
};
