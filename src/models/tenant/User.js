const ROLES = [
  "admin",
  "staff",
  "finance",
  "librarian",
  "hostel",
  "student",
  "parent",
  "registrar",
];

module.exports = (conn) => {
  if (!conn) throw new Error("User model: connection is required");
  if (conn.models.User) return conn.models.User;

  const Schema = conn.base.Schema;

  const userSchema = new Schema(
    {
      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, required: true, trim: true },

      email: { type: String, required: true, lowercase: true, trim: true },
      phone: { type: String, trim: true, default: null },

      roles: { type: [String], enum: ROLES, default: ["student"] },

      status: {
        type: String,
        enum: ["invited", "active", "suspended"],
        default: "invited",
      },

      passwordHash: { type: String, select: false, default: null },

      tokenVersion: { type: Number, default: 0 },

      staffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
      studentId: { type: Schema.Types.ObjectId, ref: "Student", default: null },

      childrenStudentIds: {
        type: [Schema.Types.ObjectId],
        ref: "Student",
        default: [],
      },

      lastLoginAt: { type: Date, default: null },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true },
  );

  userSchema.index({ status: 1 });
  userSchema.index({ roles: 1 });

  // Unique email for non-deleted users
  userSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { deletedAt: null } },
  );

  return conn.model("User", userSchema);
};

module.exports.ROLES = ROLES;
