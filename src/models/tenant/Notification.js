const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Notification) return connection.models.Notification;

  const NotificationSchema = new Schema(
    {
      // who should see it
      audience: {
        type: String,
        enum: ["admin", "staff", "student", "all"],
        default: "admin",
        index: true,
      },

      // for a specific user (optional)
      userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },

      // content
      title: { type: String, required: true, trim: true, maxlength: 140 },
      message: { type: String, required: true, trim: true, maxlength: 2000 },

      type: {
        type: String,
        enum: ["info", "success", "warning", "danger"],
        default: "info",
        index: true,
      },

      // link inside portal
      url: { type: String, trim: true, maxlength: 500, default: "" },

      // entity linking (optional, for reporting / context)
      entityType: { type: String, trim: true, maxlength: 60, default: "" }, // "invoice","applicant"
      entityId: { type: Schema.Types.ObjectId, default: null },

      // state
      isRead: { type: Boolean, default: false, index: true },
      readAt: { type: Date, default: null },

      // optional scheduling
      deliverAt: { type: Date, default: null, index: true }, // when to show
      expiresAt: { type: Date, default: null, index: true },

      // audit / soft delete
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  NotificationSchema.index({ createdAt: -1 });
  NotificationSchema.index({ audience: 1, isRead: 1, createdAt: -1 });
  NotificationSchema.index({ isDeleted: 1, audience: 1, isRead: 1, createdAt: -1 });
  NotificationSchema.index(
    { userId: 1, isRead: 1, createdAt: -1 },
    { partialFilterExpression: { userId: { $type: "objectId" } } }
  );

  NotificationSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("Notification", NotificationSchema);
};
