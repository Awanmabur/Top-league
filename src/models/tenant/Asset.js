const mongoose = require("mongoose");

module.exports = function AssetModel(conn) {
  if (!conn) throw new Error("Asset model requires a tenant connection");
  if (conn.models.Asset) return conn.models.Asset;

  const assignmentSchema = new mongoose.Schema(
    {
      assignedTo: { type: String, trim: true, required: true },
      assigneeType: {
        type: String,
        enum: ["Staff", "Department", "Office", "Student", "Other"],
        default: "Staff",
      },
      assignedAt: { type: Date, default: Date.now },
      dueBackAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["Assigned", "Returned", "Overdue"],
        default: "Assigned",
      },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const maintenanceSchema = new mongoose.Schema(
    {
      ticketId: { type: String, trim: true },
      issue: { type: String, trim: true, required: true },
      priority: {
        type: String,
        enum: ["Low", "Normal", "High", "Urgent"],
        default: "Normal",
      },
      status: {
        type: String,
        enum: ["Open", "In Progress", "Resolved"],
        default: "Open",
      },
      openedAt: { type: Date, default: Date.now },
      resolvedAt: { type: Date, default: null },
      note: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const movementSchema = new mongoose.Schema(
    {
      type: {
        type: String,
        enum: ["Created", "Assigned", "Returned", "Maintenance", "Disposed", "Updated"],
        required: true,
      },
      actorName: { type: String, trim: true, default: "" },
      note: { type: String, trim: true, default: "" },
      date: { type: Date, default: Date.now },
    },
    { _id: true }
  );

  const assetSchema = new mongoose.Schema(
    {
      assetId: { type: String, trim: true, index: true },
      assetTag: { type: String, trim: true, required: true },
      name: { type: String, trim: true, required: true, index: true },
      category: {
        type: String,
        enum: [
          "Furniture",
          "Electronics",
          "Vehicle",
          "Lab Equipment",
          "ICT",
          "Office Equipment",
          "Library",
          "Sports",
          "Other",
        ],
        default: "Other",
        index: true,
      },
      brand: { type: String, trim: true, default: "" },
      model: { type: String, trim: true, default: "" },
      serialNumber: { type: String, trim: true, default: "" },
      quantity: { type: Number, min: 1, default: 1 },
      unitCost: { type: Number, min: 0, default: 0 },
      purchaseDate: { type: Date, default: null },
      supplier: { type: String, trim: true, default: "" },
      location: { type: String, trim: true, default: "" },
      condition: {
        type: String,
        enum: ["Excellent", "Good", "Fair", "Damaged"],
        default: "Good",
      },
      status: {
        type: String,
        enum: ["Available", "Assigned", "Maintenance", "Disposed"],
        default: "Available",
        index: true,
      },
      assignedCount: { type: Number, min: 0, default: 0 },
      notes: { type: String, trim: true, default: "" },

      assignments: [assignmentSchema],
      maintenanceLogs: [maintenanceSchema],
      movements: [movementSchema],

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  assetSchema.index({ assetTag: 1 }, { unique: true });

  return conn.model("Asset", assetSchema);
};
