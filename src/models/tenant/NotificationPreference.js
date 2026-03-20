const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.NotificationPreference) return connection.models.NotificationPreference;

  const NotificationPreferenceSchema = new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },

      // channels (future-proof)
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },

      // categories you can expand later
      finance: { type: Boolean, default: true },
      admissions: { type: Boolean, default: true },
      system: { type: Boolean, default: true },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  return connection.model("NotificationPreference", NotificationPreferenceSchema);
};