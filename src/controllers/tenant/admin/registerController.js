const { normalizeTenantRoles } = require("../../../utils/tenantRoles");
const {
  ensureSingleRoleForUser,
  normalizeEmail,
} = require("../../../utils/tenantUserAccounts");

const SELF_SERVICE_STAFF_ROLES = [
  "staff",
  "lecturer",
  "finance",
  "librarian",
  "hostel",
  "registrar",
];

async function loadPrograms(req) {
  const { Subject } = req.models;
  return Subject
    ? Subject.find({ status: { $ne: "archived" } }).sort("title").lean()
    : [];
}

async function loadDepartments(req) {
  const { StaffRole } = req.models;
  return StaffRole
    ? StaffRole.find({ status: { $ne: "archived" } }).sort("name").lean()
    : [];
}

module.exports = {
  // ===== STUDENT REGISTER PAGE =====
  studentRegisterPage: async (req, res) => {
    const programs = await loadPrograms(req);

    res.render("tenant/register/student", { programs, error: null });
  },

  // ===== STUDENT REGISTER POST =====
  studentRegister: async (req, res) => {
    try {
      const { Student, User } = req.models;

      const { firstName, lastName, email, programId } = req.body;
      const cleanFirstName = String(firstName || "").trim();
      const cleanLastName = String(lastName || "").trim();
      const cleanEmail = normalizeEmail(email);

      if (!cleanFirstName || !cleanLastName || !cleanEmail) {
        const programs = await loadPrograms(req);
        return res.render("tenant/register/student", {
          programs,
          error: "First name, last name and email are required",
        });
      }

      // Prevent duplicate emails
      const exists = await User.findOne({ email: cleanEmail, deletedAt: null })
        .select("email roles")
        .lean();
      if (exists) {
        const programs = await loadPrograms(req);
        let error = "Email already registered";

        try {
          ensureSingleRoleForUser(exists, "student", cleanEmail);
        } catch (err) {
          error = err.message;
        }

        return res.render("tenant/register/student", {
          programs,
          error,
        });
      }

      // 1. Create Student profile (pending user)
      await Student.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        programId,
        status: "pending",
      });

      // 2. Create user record (no password yet)
      await User.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        roles: normalizeTenantRoles("student"),
        status: "invited",
        passwordHash: null,
      });

      res.render("tenant/register/success", {
        message: "Registration submitted. Admin will approve your account.",
      });
    } catch (err) {
      console.log(err);
      res.send("Registration failed");
    }
  },

  // ===== STAFF REGISTER PAGE =====
  staffRegisterPage: async (req, res) => {
    const departments = await loadDepartments(req);

    res.render("tenant/register/staff", { departments, error: null });
  },

  // ===== STAFF REGISTER POST =====
  staffRegister: async (req, res) => {
    try {
      const { Staff, User } = req.models;
      const { firstName, lastName, email, role, departmentId } = req.body;
      const cleanFirstName = String(firstName || "").trim();
      const cleanLastName = String(lastName || "").trim();
      const cleanEmail = normalizeEmail(email);
      const cleanRole = String(role || "").trim().toLowerCase();

      if (!cleanFirstName || !cleanLastName || !cleanEmail || !cleanRole) {
        const departments = await loadDepartments(req);
        return res.render("tenant/register/staff", {
          departments,
          error: "First name, last name, email and role are required",
        });
      }

      if (!SELF_SERVICE_STAFF_ROLES.includes(cleanRole)) {
        const departments = await loadDepartments(req);
        return res.render("tenant/register/staff", {
          departments,
          error: "Invalid staff role selected",
        });
      }

      const exists = await User.findOne({ email: cleanEmail, deletedAt: null })
        .select("email roles")
        .lean();
      if (exists) {
        const departments = await loadDepartments(req);
        let error = "Email already registered";

        try {
          ensureSingleRoleForUser(exists, cleanRole, cleanEmail);
        } catch (err) {
          error = err.message;
        }

        return res.render("tenant/register/staff", {
          departments,
          error,
        });
      }

      // Create staff profile (pending)
      await Staff.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        role: cleanRole,
        departmentId,
        status: "pending",
      });

      // Create user account
      await User.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        roles: normalizeTenantRoles(cleanRole),
        status: "invited",
        passwordHash: null,
      });

      res.render("tenant/register/success", {
        message:
          "Staff registration submitted. Admin will review and approve it.",
      });
    } catch (err) {
      console.log(err);
      res.send("Staff registration failed");
    }
  },
};
