const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Parent) return connection.models.Parent;

  const ParentSchema = new Schema(
    {
      // link to auth user
      userId: { type: Schema.Types.ObjectId, ref: "User", unique: true, sparse: true },

      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, trim: true },

      email: { type: String, required: true, lowercase: true, trim: true, unique: true },
      phone: { type: String, trim: true },

      // children they can access
      childrenStudentIds: [{ type: Schema.Types.ObjectId, ref: "Student", index: true }],

      relationship: { type: String, trim: true, default: "Guardian" },

      status: {
        type: String,
        enum: ["active", "pending", "inactive"],
        default: "pending"
      }
    },
    { timestamps: true }
  );

  return connection.model("Parent", ParentSchema);
};