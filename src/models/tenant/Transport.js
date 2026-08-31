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
      capacity: { type: Number, default: 1, min: 1 },
      // Retained only for backward-compatible migration. Real assignments live in TransportAssignment.
      assignedLearners: { type: Number, default: 0, min: 0 },
      legacyAssignedLearners: { type: Number, default: 0, min: 0 },
      status: {
        type: String,
        enum: ["active", "inactive", "maintenance", "archived"],
        default: "inactive",
        index: true,
      },
      notes: { type: String, default: "", trim: true, maxlength: 1000 },
      revision: { type: Number, default: 1, min: 1 },
      firstActivatedAt: { type: Date, default: null, index: true },
      archivedAt: { type: Date, default: null, index: true },
      migrationQuarantinedAt: { type: Date, default: null, index: true },
      migrationQuarantineReason: { type: String, default: "", trim: true, maxlength: 500 },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  TransportSchema.index(
    { routeCode: 1 },
    { name: "uniq_active_transport_route_code", unique: true, partialFilterExpression: { isDeleted: false, migrationQuarantinedAt: null } }
  );
  TransportSchema.index({ status: 1, routeName: 1, isDeleted: 1 });

  return connection.model("Transport", TransportSchema);
};
