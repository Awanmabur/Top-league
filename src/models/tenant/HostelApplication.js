const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.HostelApplication) return connection.models.HostelApplication;

  const HostelApplicationSchema = new Schema(
    {
      applicationId: { type: String, required: true, trim: true, maxlength: 80 },
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      hostel: { type: Schema.Types.ObjectId, ref: "Hostel", required: true, index: true },
      room: { type: Schema.Types.ObjectId, ref: "Hostel", required: true, index: true },

      studentName: { type: String, trim: true, maxlength: 160, default: "" },
      regNo: { type: String, trim: true, maxlength: 80, default: "", index: true },
      roomCode: { type: String, trim: true, maxlength: 80, default: "" },
      block: { type: String, trim: true, maxlength: 120, default: "" },
      preference: { type: String, trim: true, maxlength: 300, default: "" },
      notes: { type: String, trim: true, maxlength: 1500, default: "" },

      status: {
        type: String,
        enum: ["Pending", "Approved", "Denied", "Waitlist", "Allocated", "Cancelled"],
        default: "Pending",
        index: true,
      },
      isCurrent: { type: Boolean, default: true, index: true },
      submittedAt: { type: Date, default: () => new Date(), index: true },
      decidedAt: { type: Date, default: null },
      decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      allocatedAt: { type: Date, default: null },
      legacyEmbeddedId: { type: String, trim: true, maxlength: 80, default: "" },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  HostelApplicationSchema.pre("validate", function (next) {
    if (!this.student && this.studentId) this.student = this.studentId;
    if (!this.studentId && this.student) this.studentId = this.student;
    if (!this.hostel && this.room) this.hostel = this.room;
    if (!this.room && this.hostel) this.room = this.hostel;
    if (this.applicationId) this.applicationId = String(this.applicationId).trim().toUpperCase();
    next();
  });

  HostelApplicationSchema.index({ applicationId: 1 }, { unique: true });
  HostelApplicationSchema.index(
    { student: 1, isCurrent: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, isCurrent: true } }
  );
  HostelApplicationSchema.index({ hostel: 1, status: 1, submittedAt: -1 });
  HostelApplicationSchema.index(
    { legacyEmbeddedId: 1 },
    { unique: true, partialFilterExpression: { legacyEmbeddedId: { $gt: "" } } }
  );

  return connection.model("HostelApplication", HostelApplicationSchema);
};
