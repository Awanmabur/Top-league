const mongoose = require("mongoose");

module.exports = function HelpdeskTicketModel(conn) {
  if (!conn) throw new Error("HelpdeskTicket model requires a DB connection");

  const ThreadSchema = new mongoose.Schema(
    {
      author: { type: String, trim: true, default: "" },
      role: {
        type: String,
        enum: ["Requester", "Staff", "System"],
        default: "Requester",
      },
      body: { type: String, trim: true, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const HelpdeskTicketSchema = new mongoose.Schema(
    {
      ticketNo: { type: String, trim: true, default: "" },
      subject: { type: String, required: true, trim: true, maxlength: 220 },
      description: { type: String, required: true, trim: true, maxlength: 5000 },
      category: {
        type: String,
        enum: ["General", "Technical", "Finance", "Admissions", "Library", "Hostel"],
        default: "General",
      },
      requesterName: { type: String, trim: true, default: "" },
      requesterEmail: { type: String, trim: true, lowercase: true, default: "" },
      assignedTo: { type: String, trim: true, default: "" },
      priority: {
        type: String,
        enum: ["Low", "Medium", "High", "Urgent"],
        default: "Medium",
      },
      status: {
        type: String,
        enum: ["Open", "In Progress", "Resolved", "Closed"],
        default: "Open",
      },
      dueDate: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },
      slaHours: { type: Number, default: 0, min: 0 },
      stats: {
        replies: { type: Number, default: 0 },
        firstResponse: { type: String, default: "—" },
        resolutionTime: { type: String, default: "—" },
        slaBreached: { type: Boolean, default: false },
      },
      thread: { type: [ThreadSchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  HelpdeskTicketSchema.index({ status: 1, category: 1, priority: 1, createdAt: -1 });
  HelpdeskTicketSchema.index({ isDeleted: 1, createdAt: -1 });
  HelpdeskTicketSchema.index({ ticketNo: 1 });

  return conn.models.HelpdeskTicket || conn.model("HelpdeskTicket", HelpdeskTicketSchema);
};