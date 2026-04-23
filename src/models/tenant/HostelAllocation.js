const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.HostelAllocation) return connection.models.HostelAllocation;

  const HostelAllocationSchema = new Schema(
    {
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
      hostel: { type: Schema.Types.ObjectId, ref: "Hostel", required: true, index: true },
      room: { type: Schema.Types.ObjectId, ref: "HostelRoom", required: true, index: true },

      academicYear: { type: String, trim: true, maxlength: 20, required: true, index: true },
      semester: { type: Number, min: 1, max: 6, default: 1, index: true },

      bedLabel: { type: String, trim: true, maxlength: 40 }, // optional: "Bed A"
      checkInDate: { type: Date, default: () => new Date() },
      checkOutDate: { type: Date, default: null },

      status: { type: String, enum: ["active", "vacated"], default: "active", index: true },
      notes: { type: String, trim: true, maxlength: 300 },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  // prevent duplicate active allocation for same student per term
  HostelAllocationSchema.index(
    { student: 1, academicYear: 1, semester: 1, status: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false, status: "active" } }
  );

  HostelAllocationSchema.methods.vacate = async function () {
    this.status = "vacated";
    this.checkOutDate = new Date();
    await this.save();
  };

  HostelAllocationSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("HostelAllocation", HostelAllocationSchema);
};
