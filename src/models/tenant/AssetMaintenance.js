const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.AssetMaintenance) return connection.models.AssetMaintenance;

  const AssetMaintenanceSchema = new Schema(
    {
      asset: { type: Schema.Types.ObjectId, ref: "Asset", required: true, index: true },
      title: { type: String, required: true, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 600 },

      openedAt: { type: Date, default: () => new Date(), index: true },
      closedAt: { type: Date, default: null },

      status: { type: String, enum: ["open","closed"], default: "open", index: true },
      cost: { type: Number, min: 0, default: 0 },
      vendor: { type: String, trim: true, maxlength: 120 },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  AssetMaintenanceSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("AssetMaintenance", AssetMaintenanceSchema);
};
