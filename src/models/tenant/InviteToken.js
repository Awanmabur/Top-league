module.exports = (conn) => {
  const mongoose = require("mongoose");
  if (!conn) throw new Error("InviteToken model: connection is required");

  if (conn.models.InviteToken) return conn.models.InviteToken;

  const InviteTokenSchema = new mongoose.Schema(
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

      // store ONLY HMAC hash (never raw token)
      tokenHash: { type: String, required: true },

      purpose: { type: String, enum: ["set_password"], default: "set_password" },

      expiresAt: { type: Date, required: true },

      usedAt: { type: Date, default: null },
      revokedAt: { type: Date, default: null },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      createdIp: { type: String, default: null },
      createdUa: { type: String, default: null },
    },
    { timestamps: true }
  );

  // Query indexes
  InviteTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1, revokedAt: 1 });
  InviteTokenSchema.index({ tokenHash: 1, purpose: 1 }, { unique: true });

  // TTL (auto delete when expiresAt passes)
  InviteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  return conn.model("InviteToken", InviteTokenSchema);
};
