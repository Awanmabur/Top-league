const bcrypt = require("bcrypt");

module.exports = {
  // ===== STUDENT REGISTER PAGE =====
  studentRegisterPage: async (req, res) => {
    const { Program } = req.models;
    const programs = await Program.find().sort("name");

    res.render("tenant/register/student", { programs, error: null });
  },

  // ===== STUDENT REGISTER POST =====
  studentRegister: async (req, res) => {
    try {
      const { Student, User } = req.models;

      const { firstName, lastName, email, programId } = req.body;

      // Prevent duplicate emails
      const exists = await User.findOne({ email });
      if (exists) {
        const { Program } = req.models;
        const programs = await Program.find();
        return res.render("tenant/register/student", {
          programs,
          error: "Email already registered",
        });
      }

      // 1. Create Student profile (pending user)
      const student = await Student.create({
        firstName,
        lastName,
        email,
        programId,
        status: "pending",
      });

      // 2. Create user record (no password yet)
      await User.create({
        name: `${firstName} ${lastName}`,
        email,
        roles: ["student"],
        status: "pending",
        passwordHash: "", // password set after approval
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
    const { Department } = req.models;
    const departments = await Department.find().sort("name");

    res.render("tenant/register/staff", { departments, error: null });
  },

  // ===== STAFF REGISTER POST =====
  staffRegister: async (req, res) => {
    try {
      const { Staff, User } = req.models;
      const { firstName, lastName, email, role, departmentId } = req.body;

      const exists = await User.findOne({ email });
      if (exists) {
        const { Department } = req.models;
        const departments = await Department.find();
        return res.render("tenant/register/staff", {
          departments,
          error: "Email already registered",
        });
      }

      // Create staff profile (pending)
      await Staff.create({
        firstName,
        lastName,
        email,
        role,
        departmentId,
        status: "pending",
      });

      // Create user account
      await User.create({
        name: `${firstName} ${lastName}`,
        email,
        roles: [role],
        status: "pending",
        passwordHash: "",
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
