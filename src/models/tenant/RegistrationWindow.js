const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (!connection) throw new Error("RegistrationWindow model requires a mongoose connection");
  if (connection.models.RegistrationWindow) return connection.models.RegistrationWindow;

  const RegistrationWindowSchema = new Schema({
    name: { type: String, required: true, trim: true, maxlength: 160 },
    academicYear: { type: String, required: true, trim: true, maxlength: 20, index: true },
    term: { type: Number, required: true, min: 1, max: 3, index: true },
    classId: { type: String, default: "", trim: true, maxlength: 80, index: true },
    classLevel: { type: String, default: "", trim: true, uppercase: true, maxlength: 20, index: true },
    sectionId: { type: String, default: "", trim: true, maxlength: 80, index: true },
    streamId: { type: String, default: "", trim: true, maxlength: 80, index: true },
    opensAt: { type: Date, required: true, index: true },
    closesAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["draft", "open", "closed"], default: "draft", index: true },
    maxOptionalSubjects: { type: Number, default: 4, min: 0, max: 30 },
    allowDrop: { type: Boolean, default: true },
    revision: { type: Number, default: 1, min: 1 },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }, { timestamps: true });

  RegistrationWindowSchema.pre("validate", function validateWindow(next) {
    if (this.opensAt && this.closesAt && this.closesAt <= this.opensAt) {
      return next(new Error("Registration window must close after it opens."));
    }
    next();
  });

  RegistrationWindowSchema.index({ academicYear: 1, term: 1, status: 1, opensAt: 1, closesAt: 1, isDeleted: 1 });
  RegistrationWindowSchema.index({ classId: 1, classLevel: 1, sectionId: 1, streamId: 1, academicYear: 1, term: 1, isDeleted: 1 });

  return connection.model("RegistrationWindow", RegistrationWindowSchema);
};
