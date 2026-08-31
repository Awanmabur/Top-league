const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.TimetableMutationLock) return connection.models.TimetableMutationLock;

  const TimetableMutationLockSchema = new Schema(
    {
      key: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
      token: { type: String, default: "", trim: true, maxlength: 80 },
      leaseUntil: { type: Date, default: null, index: true },
    },
    { timestamps: true }
  );


  return connection.model("TimetableMutationLock", TimetableMutationLockSchema);
};
