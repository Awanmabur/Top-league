const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Period) return connection.models.Period;

  const PeriodSchema = new Schema(
    {
      title: { type: String, required: true },       // e.g. "Morning Session"
      startTime: { type: String, required: true },   // "08:00"
      endTime: { type: String, required: true },     // "09:00"
      isBreak: { type: Boolean, default: false }
    },
    { timestamps: true }
  );

  return connection.model("Period", PeriodSchema);
};
