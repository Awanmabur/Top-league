const { normalizeTenantRoles } = require("../../utils/tenantRoles");

const ROLES = [
  "admin",
  "staff",
  "lecturer",
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

      // Tracks suspensions caused specifically by the Staff employment lifecycle.
      // Manual admin suspensions clear this flag so Staff reactivation cannot
      // override an independent security decision.
      staffAccessSuspended: { type: Boolean, default: false },

      // Tracks suspensions caused specifically by Student lifecycle state.
      // Manual/security suspension clears this flag, so student reactivation
      // cannot override an independent admin decision.
      studentAccessSuspended: { type: Boolean, default: false },
      // Restores invited users back to invited (not active) when a Student lifecycle suspension ends.
      studentAccessPreviousStatus: { type: String, enum: ["invited", "active"], default: null },

      // Tracks access disabled specifically by Parent profile lifecycle.
      parentAccessSuspended: { type: Boolean, default: false },
      parentAccessPreviousStatus: { type: String, enum: ["invited", "active"], default: null },

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
  userSchema.index({ status: 1, deletedAt: 1 });

  // Unique email for non-deleted users
  userSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { deletedAt: null } },
  );

  userSchema.pre("validate", function (next) {
    this.roles = normalizeTenantRoles(this.roles);
    next();
  });

  return conn.model("User", userSchema);
};

module.exports.ROLES = ROLES;

