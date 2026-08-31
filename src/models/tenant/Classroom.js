const { Schema } = require("mongoose");
module.exports = (connection) => {
  if (!connection) throw new Error("Classroom model requires a mongoose connection");
  if (connection.models.Classroom) return connection.models.Classroom;
  const schema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    roomKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    capacity: { type: Number, required: true, min: 1 },
    type: { type: String, enum: ["lecture","lab","tutorial","hall","office","other"], default: "lecture" },
    campus: { type: String, default: "", trim: true, maxlength: 120 },
    building: { type: String, default: "", trim: true, maxlength: 120 },
    floor: { type: String, default: "", trim: true, maxlength: 60 },
    location: { type: String, default: "", trim: true, maxlength: 180 },
    status: { type: String, enum: ["available","maintenance","inactive","archived"], default: "available", index: true },
    maintenanceReason: { type: String, default: "", trim: true, maxlength: 300 },
    maintenanceUntil: { type: Date, default: null },
    notes: { type: String, default: "", trim: true, maxlength: 600 },
    revision: { type: Number, default: 1, min: 1 },
    archivedAt: { type: Date, default: null },
    migrationQuarantinedAt: { type: Date, default: null, index: true },
    migrationQuarantineReason: { type: String, default: "", trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });
  schema.index({ code: 1 }, { unique: true, partialFilterExpression: { migrationQuarantinedAt: null } });
  schema.index({ roomKey: 1 }, { unique: true, name: "uniq_active_classroom_room_key", partialFilterExpression: { migrationQuarantinedAt: null } });
  schema.index({ status: 1, campus: 1, name: 1 });
  return connection.model("Classroom", schema);
};
