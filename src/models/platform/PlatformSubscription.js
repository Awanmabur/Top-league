const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("PlatformSubscription model requires a mongoose connection");
  if (connection.models.PlatformSubscription) return connection.models.PlatformSubscription;

  const FeatureFlagsSchema = new Schema(
    {
      customDomain: { type: Boolean, default: false },
      apiAccess: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
      whiteLabel: { type: Boolean, default: false },
      advancedReports: { type: Boolean, default: false },
      helpdesk: { type: Boolean, default: false },
      backups: { type: Boolean, default: true },
      systemHealth: { type: Boolean, default: true },
    },
    { _id: false },
  );

  const PlanSnapshotSchema = new Schema(
    {
      planRevision: { type: Number, default: 1, min: 1 },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      code: { type: String, required: true, trim: true, lowercase: true, maxlength: 60 },
      billingModel: {
        type: String,
        enum: ["school_only", "student_only", "mixed_split"],
        required: true,
      },
      pricePerSchool: { type: Number, default: 0, min: 0 },
      pricePerStudent: { type: Number, default: 0, min: 0 },
      platformSharePercent: { type: Number, default: 0, min: 0, max: 100 },
      currency: { type: String, default: "USD", uppercase: true, trim: true, maxlength: 10 },
      billingInterval: {
        type: String,
        enum: ["monthly", "termly", "semester", "yearly", "custom"],
        default: "monthly",
      },
      trialDays: { type: Number, default: 0, min: 0 },
      maxStudents: { type: Number, default: 0, min: 0 },
      maxStaff: { type: Number, default: 0, min: 0 },
      maxCampuses: { type: Number, default: 1, min: 0 },
      enabledModules: [{ type: String, trim: true, maxlength: 100 }],
      featureFlags: { type: FeatureFlagsSchema, default: () => ({}) },
    },
    { _id: false },
  );

  const HistorySchema = new Schema(
    {
      at: { type: Date, default: Date.now },
      action: { type: String, required: true, trim: true, maxlength: 80 },
      fromStatus: { type: String, default: "", trim: true, maxlength: 40 },
      toStatus: { type: String, default: "", trim: true, maxlength: 40 },
      reason: { type: String, default: "", trim: true, maxlength: 500 },
      actorId: { type: Schema.Types.ObjectId, ref: "PlatformUser" },
      planId: { type: Schema.Types.ObjectId, ref: "Plan" },
      paymentId: { type: Schema.Types.ObjectId, ref: "PlatformPayment" },
      revision: { type: Number, min: 1 },
    },
    { _id: false },
  );

  const PlatformSubscriptionSchema = new Schema(
    {
      tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
      planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
      planSnapshot: { type: PlanSnapshotSchema, required: true },
      status: {
        type: String,
        enum: ["trial", "active", "past_due", "suspended", "cancelled", "expired"],
        default: "trial",
      },
      startsAt: { type: Date },
      trialEndsAt: { type: Date },
      currentPeriodStart: { type: Date },
      currentPeriodEnd: { type: Date },
      suspendedAt: { type: Date },
      cancelledAt: { type: Date },
      expiredAt: { type: Date },
      statusReason: { type: String, default: "", trim: true, maxlength: 500 },
      lastPaymentId: { type: Schema.Types.ObjectId, ref: "PlatformPayment" },
      lastBilledAt: { type: Date },
      revision: { type: Number, default: 1, min: 1 },
      history: { type: [HistorySchema], default: [] },
      migrationQuarantined: { type: Boolean, default: false },
      quarantineReason: { type: String, default: "", trim: true, maxlength: 500 },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date },
      createdBy: { type: Schema.Types.ObjectId, ref: "PlatformUser" },
      updatedBy: { type: Schema.Types.ObjectId, ref: "PlatformUser" },
    },
    { timestamps: true },
  );

  PlatformSubscriptionSchema.index(
    { tenantId: 1 },
    {
      unique: true,
      name: "one_current_platform_subscription_per_tenant",
      partialFilterExpression: { isDeleted: false },
    },
  );
  PlatformSubscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
  PlatformSubscriptionSchema.index({ planId: 1, status: 1 });
  PlatformSubscriptionSchema.index({ lastPaymentId: 1 }, { sparse: true });

  return connection.model("PlatformSubscription", PlatformSubscriptionSchema);
};
