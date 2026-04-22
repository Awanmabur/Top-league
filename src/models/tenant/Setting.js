const mongoose = require("mongoose");

module.exports = function SettingModel(conn) {
  if (!conn) throw new Error("Setting model requires a DB connection");

  const SettingSchema = new mongoose.Schema(
    {
      key: { type: String, required: true, trim: true, unique: true },
      value: { type: mongoose.Schema.Types.Mixed, default: {} },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  SettingSchema.index({ isDeleted: 1, updatedAt: -1 });

  return conn.models.Setting || conn.model("Setting", SettingSchema);
};
