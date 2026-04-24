const { normalizeTenantRoles } = require("../../../utils/tenantRoles");
const {
  ensureSingleRoleForUser,
  normalizeEmail,
} = require("../../../utils/tenantUserAccounts");

const ALLOWED_ROLES = ["staff", "lecturer", "finance", "librarian", "hostel", "registrar"];

module.exports = {
  form(req, res) {
    res.render("tenant/auth/register-staff", { error: null });
  },

  async register(req, res) {
    try {
      const { User, Staff } = req.models;
      const { firstName, lastName, email, role } = req.body;
      const cleanFirstName = String(firstName || "").trim();
      const cleanLastName = String(lastName || "").trim();
      const cleanEmail = normalizeEmail(email);
      const cleanRole = String(role || "").trim().toLowerCase();

      if (!cleanFirstName || !cleanLastName || !cleanEmail || !cleanRole) {
        return res.render("tenant/auth/register-staff", {
          error: "First name, last name, email and role are required"
        });
      }

      if (!ALLOWED_ROLES.includes(cleanRole)) {
        return res.render("tenant/auth/register-staff", {
          error: "Invalid staff role selected"
        });
      }

      const exists = await User.findOne({ email: cleanEmail, deletedAt: null })
        .select("email roles")
        .lean();
      if (exists) {
        let error = "Email already exists";

        try {
          ensureSingleRoleForUser(exists, cleanRole, cleanEmail);
        } catch (err) {
          error = err.message;
        }

        return res.render("tenant/auth/register-staff", { error });
      }

      const staff = await Staff.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        role: cleanRole,
      });

      await User.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        roles: normalizeTenantRoles(cleanRole),
        staffId: staff._id,
        status: "invited",
        passwordHash: null,
      });

      res.render("tenant/auth/register-success");
    } catch (err) {
      console.error(err);
      res.render("tenant/auth/register-staff", { error: "Registration failed" });
    }
  }
};
