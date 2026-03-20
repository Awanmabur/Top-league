// src/models/platform/SupportTicket.js
const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.SupportTicket) {
    return connection.models.SupportTicket;
  }

  const TicketMessageSchema = new Schema(
    {
      senderType: {
        type: String,
        enum: ["platform", "tenant"],
        required: true,
      },

      senderName: {
        type: String,
        default: "",
        trim: true,
        maxlength: 120,
      },

      senderEmail: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
        maxlength: 180,
      },

      body: {
        type: String,
        required: true,
        trim: true,
        maxlength: 5000,
      },

      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
    { _id: true }
  );

  const SupportTicketSchema = new Schema(
    {
      ticketNo: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        maxlength: 80,
      },

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
      },

      subject: {
        type: String,
        required: true,
        trim: true,
        maxlength: 220,
      },

      category: {
        type: String,
        enum: ["billing", "technical", "account", "setup", "feature_request", "other"],
        default: "technical",
      },

      priority: {
        type: String,
        enum: ["low", "medium", "high", "urgent"],
        default: "medium",
      },

      status: {
        type: String,
        enum: ["open", "pending", "resolved", "closed"],
        default: "open",
      },

      assignedTo: {
        type: Schema.Types.ObjectId,
        ref: "PlatformUser",
      },

      requesterName: {
        type: String,
        default: "",
        trim: true,
        maxlength: 120,
      },

      requesterEmail: {
        type: String,
        default: "",
        trim: true,
        lowercase: true,
        maxlength: 180,
      },

      messages: [TicketMessageSchema],

      resolutionNote: {
        type: String,
        default: "",
        trim: true,
        maxlength: 3000,
      },

      firstResponseAt: {
        type: Date,
      },

      resolvedAt: {
        type: Date,
      },

      closedAt: {
        type: Date,
      },

      createdByTenant: {
        type: Boolean,
        default: true,
      },
    },
    { timestamps: true }
  );

  SupportTicketSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
  SupportTicketSchema.index({ assignedTo: 1, status: 1 });
  SupportTicketSchema.index({ priority: 1, status: 1 });

  return connection.model("SupportTicket", SupportTicketSchema);
};