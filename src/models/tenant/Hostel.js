const mongoose = require("mongoose");

module.exports = function HostelModel(conn) {
  if (!conn) throw new Error("Hostel model requires a tenant connection");
  if (conn.models.Hostel) return conn.models.Hostel;

  const applicationSchema = new mongoose.Schema(
    {
      applicationId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      preference: { type: String, trim: true, default: "" },
      submittedAt: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ["Pending", "Approved", "Denied", "Waitlist"],
        default: "Pending",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const checkinSchema = new mongoose.Schema(
    {
      checkinId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      roomCode: { type: String, trim: true, required: true },
      checkInDate: { type: Date, default: Date.now },
      checkOutDate: { type: Date, default: null },
      status: {
        type: String,
        enum: ["Checked-in", "Checked-out"],
        default: "Checked-in",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const maintenanceSchema = new mongoose.Schema(
    {
      ticketId: { type: String, trim: true },
      roomCode: { type: String, trim: true, required: true },
      issue: { type: String, trim: true, required: true },
      priority: {
        type: String,
        enum: ["Normal", "High", "Urgent"],
        default: "Normal",
      },
      status: {
        type: String,
        enum: ["Open", "In Progress", "Resolved"],
        default: "Open",
      },
      createdAt: { type: Date, default: Date.now },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const disciplineSchema = new mongoose.Schema(
    {
      caseId: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      violation: { type: String, trim: true, required: true },
      action: { type: String, trim: true, default: "" },
      status: {
        type: String,
        enum: ["Open", "Closed"],
        default: "Open",
      },
      date: { type: Date, default: Date.now },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const feeSchema = new mongoose.Schema(
    {
      receiptNo: { type: String, trim: true },
      studentName: { type: String, trim: true, required: true },
      regNo: { type: String, trim: true, default: "" },
      roomCode: { type: String, trim: true, required: true },
      amount: { type: Number, min: 0, default: 0 },
      status: {
        type: String,
        enum: ["Pending", "Paid"],
        default: "Pending",
      },
      date: { type: Date, default: Date.now },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const hostelSchema = new mongoose.Schema(
    {
      roomId: { type: String, trim: true, index: true },
      block: { type: String, trim: true, required: true, index: true },
      code: { type: String, trim: true, required: true },
      gender: {
        type: String,
        enum: ["Male", "Female", "Mixed"],
        default: "Mixed",
        index: true,
      },
      type: {
        type: String,
        enum: ["Standard", "Premium", "VIP"],
        default: "Standard",
      },
      beds: { type: Number, min: 1, default: 1 },
      occupied: { type: Number, min: 0, default: 0 },
      pricePerSemester: { type: Number, min: 0, default: 0 },
      status: {
        type: String,
        enum: ["Available", "Full", "Maintenance", "Closed"],
        default: "Available",
        index: true,
      },
      warden: { type: String, trim: true, default: "" },
      notes: { type: String, trim: true, default: "" },

      applications: [applicationSchema],
      checkins: [checkinSchema],
      maintenanceTickets: [maintenanceSchema],
      disciplineCases: [disciplineSchema],
      feeReceipts: [feeSchema],

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  hostelSchema.index({ code: 1 }, { unique: true });

  return conn.model("Hostel", hostelSchema);
};
