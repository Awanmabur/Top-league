const mongoose = require("mongoose");

module.exports = function FeeStructureModel(conn) {
  if (!conn) throw new Error("FeeStructure model requires a DB connection");

  const FeeStructureSchema = new mongoose.Schema(
    {
      name: { type: String, trim: true, required: true },

      programId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Program",
        default: null,
      },

      classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Class",
        default: null,
      },

      intakeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Intake",
        default: null,
      },

      academicYear: { type: String, trim: true, default: "" },
      term: { type: String, trim: true, default: "" },

      items: [
        {
          title: { type: String, trim: true, required: true },
          category: {
            type: String,
            enum: [
              "Tuition",
              "Registration",
              "Library",
              "Hostel",
              "Examination",
              "Transport",
              "Other",
            ],
            default: "Tuition",
          },
          amount: { type: Number, default: 0, min: 0 },
          required: { type: Boolean, default: true },
          note: { type: String, trim: true, default: "" },
        },
      ],

      totalAmount: { type: Number, default: 0, min: 0 },

      status: {
        type: String,
        enum: ["Active", "Inactive", "Archived"],
        default: "Active",
      },

      notes: { type: String, trim: true, default: "" },

      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  FeeStructureSchema.pre("validate", function (next) {
    this.totalAmount = Array.isArray(this.items)
      ? this.items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      : 0;
    next();
  });

  FeeStructureSchema.index({ name: 1, academicYear: 1, term: 1 });
  FeeStructureSchema.index({ programId: 1, classId: 1 });
  FeeStructureSchema.index({ status: 1 });
  FeeStructureSchema.index({ isDeleted: 1, createdAt: -1 });

  return conn.models.FeeStructure || conn.model("FeeStructure", FeeStructureSchema);
};