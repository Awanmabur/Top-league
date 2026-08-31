const mongoose = require("mongoose");
const crypto = require("crypto");

function newTicketNo() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `TKT-${day}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

module.exports = function HelpdeskTicketModel(conn) {
  if (!conn) throw new Error("HelpdeskTicket model requires a DB connection");
  if (conn.models.HelpdeskTicket) return conn.models.HelpdeskTicket;

  const ThreadSchema = new mongoose.Schema(
    {
      authorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
      author: { type: String, trim: true, default: "" },
      role: {
        type: String,
        enum: ["Requester", "Staff", "System"],
        default: "Requester",
      },
      body: { type: String, required: true, trim: true, maxlength: 5000 },
      createdAt: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const HelpdeskTicketSchema = new mongoose.Schema(
    {
      ticketNo: { type: String, trim: true, required: true, default: newTicketNo },
      subject: { type: String, required: true, trim: true, maxlength: 220 },
      description: { type: String, required: true, trim: true, maxlength: 5000 },
      category: {
        type: String,
        enum: ["General", "Technical", "Finance", "Admissions", "Library", "Hostel", "Academic", "Attendance"],
        default: "General",
      },
      requesterUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
      requesterType: {
        type: String,
        enum: ["Student", "Parent", "Staff", "Admin", "External"],
        default: "External",
        index: true,
      },
      relatedStudentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null, index: true },
      requesterName: { type: String, trim: true, default: "" },
      requesterEmail: { type: String, trim: true, lowercase: true, default: "" },
      assignedToUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
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
      firstResponseAt: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },
      closedAt: { type: Date, default: null },
      requesterLastReplyAt: { type: Date, default: null },
      staffLastReplyAt: { type: Date, default: null },
      slaHours: { type: Number, default: 0, min: 0 },
      stats: {
        replies: { type: Number, default: 0, min: 0 },
        firstResponse: { type: String, default: "—" },
        resolutionTime: { type: String, default: "—" },
        slaBreached: { type: Boolean, default: false },
      },
      thread: { type: [ThreadSchema], default: [] },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  HelpdeskTicketSchema.index({ ticketNo: 1 }, { unique: true });
  HelpdeskTicketSchema.index({ requesterUserId: 1, isDeleted: 1, updatedAt: -1 });
  HelpdeskTicketSchema.index({ status: 1, category: 1, priority: 1, createdAt: -1 });
  HelpdeskTicketSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.model("HelpdeskTicket", HelpdeskTicketSchema);
};
