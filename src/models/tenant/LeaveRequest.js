const mongoose = require("mongoose");

module.exports = function LeaveRequestModel(conn) {
  if (!conn) throw new Error("LeaveRequest model requires a DB connection");

  const LeaveRequestSchema = new mongoose.Schema(
    {
      staffId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Staff",
        required: true,
        index: true,
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
        index: true,
      },

      leaveType: {
        type: String,
        enum: [
          "Annual",
          "Sick",
          "Maternity",
          "Paternity",
          "Study",
          "Compassionate",
          "Unpaid",
          "Other",
        ],
        default: "Annual",
      },

      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true },
      days: { type: Number, default: 0 },

      reason: { type: String, trim: true, default: "" },
      attachmentUrl: { type: String, trim: true, default: "" },

      status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected", "Cancelled"],
        default: "Pending",
        index: true,
      },

      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      approvedAt: { type: Date, default: null },
      rejectionReason: { type: String, trim: true, default: "" },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  LeaveRequestSchema.index({ isDeleted: 1, status: 1, leaveType: 1, startDate: -1 });
  LeaveRequestSchema.index({ staffId: 1, startDate: -1, endDate: -1 });

  return conn.models.LeaveRequest || conn.model("LeaveRequest", LeaveRequestSchema);
};