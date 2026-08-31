// src/models/platform/PlatformPayment.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.PlatformPayment) {
    return connection.models.PlatformPayment;
  }

  const PlatformPaymentSchema = new Schema(
    {
      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
      },

      planId: {
        type: Schema.Types.ObjectId,
        ref: "Plan",
      },

      subscriptionId: {
        type: Schema.Types.ObjectId,
        ref: "PlatformSubscription",
      },

      subscriptionRevision: {
        type: Number,
        min: 1,
      },

      type: {
        type: String,
        enum: [
          "school_subscription",
          "student_subscription",
          "revenue_split",
          "manual_adjust",
          "refund",
          "credit",
        ],
        required: true,
      },

      amount: {
        type: Number,
        required: true,
      },

      currency: {
        type: String,
        default: "USD",
        uppercase: true,
        trim: true,
        maxlength: 10,
      },

      reference: {
        type: String,
        trim: true,
        maxlength: 120,
      },

      referenceKey: {
        type: String,
        trim: true,
        maxlength: 260,
      },

      provider: {
        type: String,
        enum: ["manual", "stripe", "flutterwave", "pesapal", "mtn", "airtel", "bank", "other"],
        default: "manual",
      },

      status: {
        type: String,
        enum: ["pending", "processing", "completed", "failed", "cancelled", "refunded", "reconciliation_required"],
        default: "pending",
      },

      periodStart: {
        type: Date,
      },

      periodEnd: {
        type: Date,
      },

      paidAt: {
        type: Date,
      },

      notes: {
        type: String,
        default: "",
        trim: true,
        maxlength: 1000,
      },

      meta: {
        type: Schema.Types.Mixed,
        default: {},
      },

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },

      revision: {
        type: Number,
        default: 1,
        min: 1,
      },

      migrationQuarantined: {
        type: Boolean,
        default: false,
      },

      quarantineReason: {
        type: String,
        default: "",
        trim: true,
        maxlength: 500,
      },
    },
    { timestamps: true }
  );

  PlatformPaymentSchema.index({ tenantId: 1, createdAt: -1 });
  PlatformPaymentSchema.index({ status: 1, type: 1 });
  PlatformPaymentSchema.index({ status: 1, createdAt: -1 });
  PlatformPaymentSchema.index({ reference: 1 }, { sparse: true });
  PlatformPaymentSchema.index(
    { referenceKey: 1 },
    {
      unique: true,
      name: "unique_platform_payment_reference_key",
      partialFilterExpression: {
        referenceKey: { $type: "string" },
        migrationQuarantined: false,
      },
    },
  );
  PlatformPaymentSchema.index({ subscriptionId: 1, createdAt: -1 });

  return connection.model("PlatformPayment", PlatformPaymentSchema);
};
