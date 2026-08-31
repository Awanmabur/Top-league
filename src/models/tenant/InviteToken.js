module.exports = (conn) => {
  const mongoose = require("mongoose");
  if (!conn) throw new Error("InviteToken model: connection is required");
  if (conn.models.InviteToken) return conn.models.InviteToken;
  const InviteTokenSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true },
    hashVersion: { type: Number, enum: [1], default: 1 },
    purpose: { type: String, enum: ["set_password"], default: "set_password" },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdIp: { type: String, default: null, maxlength: 128 },
    createdUa: { type: String, default: null, maxlength: 600 },
  }, { timestamps: true });
  InviteTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1, revokedAt: 1 });
  InviteTokenSchema.index({ tokenHash: 1, purpose: 1 }, { unique: true });
  InviteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return conn.model("InviteToken", InviteTokenSchema);
};
