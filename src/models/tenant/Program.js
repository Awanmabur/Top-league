const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Program) return connection.models.Program;

  const ProgramSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 160 },
      code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30, unique: true },

      // ✅ select department from DB
      department: { type: Schema.Types.ObjectId, ref: "Department", required: true, index: true },

      durationYears: { type: Number, default: 3, min: 0, max: 20 },

      // ✅ your UI/controller uses "short" (max 500)
      short: { type: String, trim: true, maxlength: 500, default: "" },

      description: { type: String, trim: true, maxlength: 2000, default: "" },

      feesStructure: {
        tuition: { type: Number, min: 0, max: 100000000 },
        registration: { type: Number, min: 0, max: 100000000 },
        graduation: { type: Number, min: 0, max: 100000000 },
        other: { type: Number, min: 0, max: 100000000 },
      },

      faculty: { type: String, trim: true, maxlength: 80, default: "" },
      level: { type: String, trim: true, maxlength: 40, default: "" },

      status: { type: String, enum: ["active", "draft", "archived"], default: "active", index: true },

      seats: { type: Number, default: 0, min: 0, max: 100000 },
      fee: { type: Number, default: 0, min: 0, max: 100000000 },

      reqs: { type: String, trim: true, maxlength: 1200, default: "" },
      modules: [{ type: String, trim: true, maxlength: 120 }],

      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    { timestamps: true }
  );

  ProgramSchema.index({ name: 1 });
  ProgramSchema.index({ faculty: 1 });
  ProgramSchema.index({ level: 1 });

  return connection.model("Program", ProgramSchema);
};