const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.HostelRoom) return connection.models.HostelRoom;

  const HostelRoomSchema = new Schema(
    {
      hostel: { type: Schema.Types.ObjectId, ref: "Hostel", required: true, index: true },
      roomNo: { type: String, required: true, trim: true, maxlength: 40 },
      capacity: { type: Number, min: 1, max: 50, default: 2 },
      pricePerTerm: { type: Number, min: 0, default: 0 },
      notes: { type: String, trim: true, maxlength: 300 },

      isActive: { type: Boolean, default: true, index: true },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  HostelRoomSchema.pre("validate", function (next) {
    if (this.roomNo) this.roomNo = String(this.roomNo).trim().toUpperCase().replace(/\s+/g, "-");
    next();
  });

  // Unique roomNo per hostel (ignore deleted)
  HostelRoomSchema.index(
    { hostel: 1, roomNo: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  HostelRoomSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.isActive = false;
    await this.save();
  };

  return connection.model("HostelRoom", HostelRoomSchema);
};
