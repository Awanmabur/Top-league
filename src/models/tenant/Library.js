const { Schema } = require("mongoose");

module.exports = (connection) => {
  if (connection.models.LibraryBook) return connection.models.LibraryBook;

  const BookSchema = new Schema(
    {
      title: { type: String, required: true },
      isbn:  { type: String, unique: true },

      author: String,
      category: String,

      quantity:        { type: Number, default: 1 },
      availableCopies: { type: Number, default: 1 },

      borrowedBy: {
        studentId: { type: Schema.Types.ObjectId, ref: "Student" },
        dueDate:   Date,
        returned:  Boolean
      }
    },
    { timestamps: true }
  );

  return connection.model("LibraryBook", BookSchema);
};
