const { Schema } = require("mongoose");
module.exports = (connection) => {
  if (!connection) throw new Error("AssetMaintenance model requires a mongoose connection");
  if (connection.models.AssetMaintenance) return connection.models.AssetMaintenance;
  const schema = new Schema({
    asset: { type: Schema.Types.ObjectId, ref: "Asset", required: true, index: true },
    ticketCode: { type: String, required: true, trim: true, maxlength: 40 },
    sourceEmbeddedId: { type: String, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 600, default: "" },
    priority: { type: String, enum: ["low","normal","high","urgent"], default: "normal", index: true },
    status: { type: String, enum: ["open","in_progress","resolved","cancelled"], default: "open", index: true },
    openedAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cost: { type: Number, min: 0, default: 0 },
    vendor: { type: String, trim: true, maxlength: 120, default: "" },
    resolution: { type: String, trim: true, maxlength: 600, default: "" },
    revision: { type: Number, default: 1, min: 1 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });
  schema.index({ ticketCode: 1 }, { unique: true });
  schema.index({ asset: 1, status: 1, isDeleted: 1 });
  schema.index({ sourceEmbeddedId: 1 }, { name: "uniq_asset_maintenance_source", unique: true, sparse: true });
  return connection.model("AssetMaintenance", schema);
};
