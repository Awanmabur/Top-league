const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("Transport model requires a mongoose connection");
  if (connection.models.Transport) return connection.models.Transport;

  const TransportSchema = new Schema(
    {
      routeName: { type: String, required: true, trim: true, maxlength: 160 },
      routeCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
      vehicleName: { type: String, default: "", trim: true, maxlength: 120 },
      vehicleRegNo: { type: String, default: "", trim: true, uppercase: true, maxlength: 40, index: true },
      driverName: { type: String, default: "", trim: true, maxlength: 120 },
      driverPhone: { type: String, default: "", trim: true, maxlength: 40 },
      pickupPoints: { type: [String], default: [] },
      feeAmount: { type: Number, default: 0, min: 0 },
      capacity: { type: Number, default: 0, min: 0 },
      assignedLearners: { type: Number, default: 0, min: 0 },
      status: {
        type: String,
        enum: ["active", "inactive", "maintenance"],
        default: "active",
        index: true,
      },
      notes: { type: String, default: "", trim: true, maxlength: 1000 },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  TransportSchema.index({ routeCode: 1 }, { unique: true });
  TransportSchema.index({ status: 1, routeName: 1 });

  TransportSchema.pre("validate", function normalize(next) {
    this.routeCode = String(this.routeCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/(^-|-$)/g, "");
    this.vehicleRegNo = String(this.vehicleRegNo || "").trim().toUpperCase();
    this.pickupPoints = Array.isArray(this.pickupPoints)
      ? this.pickupPoints.map((x) => String(x || "").trim()).filter(Boolean)
      : String(this.pickupPoints || "")
          .split(/\r?\n|,/)
          .map((x) => x.trim())
          .filter(Boolean);
    next();
  });

  return connection.model("Transport", TransportSchema);
};
