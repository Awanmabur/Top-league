const { normalizeTenantRoles } = require("../../../utils/tenantRoles");
const {
  ensureSingleRoleForUser,
  normalizeEmail,
} = require("../../../utils/tenantUserAccounts");

module.exports = {
  form(req, res) {
    const { Subject } = req.models;
    const query = Subject ? Subject.find({ status: { $ne: "archived" } }).sort({ title: 1 }) : Promise.resolve([]);
    query.then(programs =>
      res.render("tenant/auth/register-student", { programs, error: null })
    );
  },

  async register(req, res) {
    try {
      const { User, Student } = req.models;
      const { firstName, lastName, email, phone, programId } = req.body;
      const cleanFirstName = String(firstName || "").trim();
      const cleanLastName = String(lastName || "").trim();
      const cleanEmail = normalizeEmail(email);
      const cleanPhone = String(phone || "").trim();

      if (!cleanFirstName || !cleanLastName || !cleanEmail) {
        return res.render("tenant/auth/register-student", {
          error: "First name, last name and email are required", programs: []
        });
      }

      const exists = await User.findOne({ email: cleanEmail, deletedAt: null })
        .select("email roles")
        .lean();
      if (exists) {
        let error = "Email is already registered";

        try {
          ensureSingleRoleForUser(exists, "student", cleanEmail);
        } catch (err) {
          error = err.message;
        }

        return res.render("tenant/auth/register-student", {
          error, programs: []
        });
      }

      const student = await Student.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        phone: cleanPhone,
        programId
      });

      await User.create({
        firstName: cleanFirstName,
        lastName: cleanLastName,
        email: cleanEmail,
        roles: normalizeTenantRoles("student"),
        studentId: student._id,
        status: "invited",
        passwordHash: null,
      });

      res.render("tenant/auth/register-success");
    } catch (err) {
      console.error(err);
      res.render("tenant/auth/register-student", { error: "Registration failed", programs: [] });
    }
  }
};
