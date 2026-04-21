const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.DisciplineCase) return connection.models.DisciplineCase;

  const DocSchema = new Schema(
    {
      url: { type: String, required: true, trim: true, maxlength: 800 },
      publicId: { type: String, required: true, trim: true, maxlength: 300 },
      resourceType: { type: String, trim: true, maxlength: 20, default: "auto" },
      originalName: { type: String, trim: true, maxlength: 200 },
      bytes: { type: Number, default: 0 },
      mimeType: { type: String, trim: true, maxlength: 80 },
      uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false }
  );

  const ActionSchema = new Schema(
    {
      action: { type: String, required: true, trim: true, maxlength: 120 },
      details: { type: String, trim: true, maxlength: 500 },
      date: { type: Date, default: Date.now },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { _id: false }
  );

  const DisciplineCaseSchema = new Schema(
    {
      caseNo: { type: String, required: true, trim: true, maxlength: 30 },
      student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },

      incidentDate: { type: Date, required: true },
      category: { type: String, required: true, trim: true, maxlength: 80 },
      description: { type: String, required: true, trim: true, maxlength: 1500 },

      status: {
        type: String,
        enum: ["open", "investigating", "hearing", "resolved", "dismissed"],
        default: "open",
        index: true,
      },

      studentStatement: { type: DocSchema, default: null },
      attachments: { type: [DocSchema], default: [] },

      actions: { type: [ActionSchema], default: [] },
      note: { type: String, trim: true, maxlength: 800 },

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  DisciplineCaseSchema.index(
    { caseNo: 1 },
    { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } }
  );

  DisciplineCaseSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    await this.save();
  };

  return connection.model("DisciplineCase", DisciplineCaseSchema);
};
