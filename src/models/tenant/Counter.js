const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.Counter) return connection.models.Counter;

  const CounterSchema = new Schema(
    {
      key: { type: String, required: true, unique: true },
      seq: { type: Number, default: 0 },
    },
    { timestamps: true }
  );

  return connection.model("Counter", CounterSchema);
};
