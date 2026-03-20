const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Classroom) return connection.models.Classroom;

  const ClassroomSchema = new Schema(
    {
      name: { type: String, required: true },          // e.g., Lab 3, A1, B12
      capacity: { type: Number, required: true },
      type: {
        type: String,
        enum: ["lecture", "lab", "tutorial", "hall"],
        default: "lecture"
      },
      location: String,
      status: {
        type: String,
        enum: ["available", "maintenance"],
        default: "available"
      }
    },
    { timestamps: true }
  );

  return connection.model("Classroom", ClassroomSchema);
};
