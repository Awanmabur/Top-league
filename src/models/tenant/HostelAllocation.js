const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.HostelAllocation) return connection.models.HostelAllocation;

  const HostelAllocationSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      // Kept in sync for older portal code and simpler tenant queries.
      studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      // The active Admin Hostel model represents a configured room. Both aliases point
      // to that same canonical room so existing audience/portal code can converge.
      hostel: { type: Schema.Types.ObjectId, ref: "Hostel", required: true, index: true },
      room: { type: Schema.Types.ObjectId, ref: "Hostel", required: true, index: true },

      studentName: { type: String, trim: true, maxlength: 160, default: "" },
      regNo: { type: String, trim: true, maxlength: 80, default: "", index: true },
      roomCode: { type: String, trim: true, maxlength: 80, default: "" },
      block: { type: String, trim: true, maxlength: 120, default: "" },

      academicYear: { type: String, trim: true, maxlength: 20, required: true, index: true },
      semester: { type: Number, min: 1, max: 3, default: 1, index: true },

      bedLabel: { type: String, trim: true, maxlength: 40, default: "" },
      checkInDate: { type: Date, default: () => new Date(), index: true },
      checkOutDate: { type: Date, default: null },

      status: { type: String, enum: ["active", "vacated"], default: "active", index: true },
      notes: { type: String, trim: true, maxlength: 1000, default: "" },
      sourceApplicationId: { type: Schema.Types.ObjectId, ref: "HostelApplication", default: null, index: true },
      legacyCheckinId: { type: String, trim: true, maxlength: 80, default: "" },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  HostelAllocationSchema.pre("validate", function (next) {
    if (!this.student && this.studentId) this.student = this.studentId;
    if (!this.studentId && this.student) this.studentId = this.student;
    if (!this.hostel && this.room) this.hostel = this.room;
    if (!this.room && this.hostel) this.room = this.hostel;
    next();
  });

  // One student may have history, but never two live rooms at the same time.
  HostelAllocationSchema.index(
    { student: 1, status: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, status: "active" } }
  );
  HostelAllocationSchema.index({ hostel: 1, status: 1, isDeleted: 1 });
  HostelAllocationSchema.index(
    { legacyCheckinId: 1 },
    { unique: true, partialFilterExpression: { legacyCheckinId: { $gt: "" } } }
  );
  HostelAllocationSchema.index({ academicYear: 1, semester: 1, status: 1 });

  HostelAllocationSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    if (this.status === "active") {
      this.status = "vacated";
      this.checkOutDate = this.checkOutDate || new Date();
    }
    await this.save();
  };

  return connection.model("HostelAllocation", HostelAllocationSchema);
};
