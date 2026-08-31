const mongoose = require("mongoose");

const STATUS = ["Active", "Inactive", "Archived"];

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

module.exports = (conn) => {
  if (!conn) throw new Error("Tenant connection is required for FeeStructure model");
  if (conn.models.FeeStructure) return conn.models.FeeStructure;

  const ItemSchema = new mongoose.Schema(
    {
      title: { type: String, required: true, trim: true, maxlength: 160 },
      category: { type: String, default: "Other", trim: true, maxlength: 80 },
      amount: { type: Number, required: true, min: 0 },
      required: { type: Boolean, default: true },
      note: { type: String, default: "", trim: true, maxlength: 300 },
    },
    { _id: false }
  );

  const FeeStructureSchema = new mongoose.Schema(
    {
      structureCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
      name: { type: String, required: true, trim: true, maxlength: 180 },
      programId: { type: mongoose.Schema.Types.ObjectId, ref: "Program", default: null, index: true },
      classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", default: null, index: true },
      intakeId: { type: mongoose.Schema.Types.ObjectId, ref: "Intake", default: null, index: true },
      academicYear: { type: String, default: "", trim: true, maxlength: 40, index: true },
      term: { type: String, default: "", trim: true, maxlength: 80, index: true },
      status: { type: String, enum: STATUS, default: "Active", index: true },
      items: { type: [ItemSchema], default: [] },
      totalAmount: { type: Number, default: 0, min: 0 },
      itemsCount: { type: Number, default: 0, min: 0 },
      requiredItemsCount: { type: Number, default: 0, min: 0 },
      notes: { type: String, default: "", trim: true, maxlength: 2000 },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      archivedAt: { type: Date, default: null },
      archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null },
      deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  FeeStructureSchema.pre("validate", function normalize(next) {
    this.structureCode = cleanText(this.structureCode, 48).toUpperCase();
    this.name = cleanText(this.name, 180);
    this.academicYear = cleanText(this.academicYear, 40);
    this.term = cleanText(this.term, 80);
    this.notes = cleanText(this.notes, 2000);
    this.items = (Array.isArray(this.items) ? this.items : []).slice(0, 100).map((item) => ({
      title: cleanText(item.title, 160),
      category: cleanText(item.category || "Other", 80) || "Other",
      amount: Math.max(0, Number(item.amount || 0)),
      required: item.required !== false,
      note: cleanText(item.note, 300),
    })).filter((item) => item.title);
    this.totalAmount = this.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    this.itemsCount = this.items.length;
    this.requiredItemsCount = this.items.filter((item) => item.required).length;
    if (this.status === "Archived" && !this.archivedAt) this.archivedAt = new Date();
    if (this.status !== "Archived") {
      this.archivedAt = null;
      this.archivedBy = null;
    }
    next();
  });

  FeeStructureSchema.index({ structureCode: 1 }, { unique: true });
  FeeStructureSchema.index({ isDeleted: 1, status: 1, academicYear: 1, term: 1 });
  FeeStructureSchema.index({ programId: 1, classId: 1, intakeId: 1, status: 1 });
  FeeStructureSchema.index({ name: 1, academicYear: 1, term: 1 });

  return conn.model("FeeStructure", FeeStructureSchema);
};
