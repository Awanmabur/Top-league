module.exports = {
  form(req, res) {
    res.render("tenant/auth/register-staff", { error: null });
  },

  async register(req, res) {
    try {
      const { User, Staff } = req.models;
      const { firstName, lastName, email, role } = req.body;

      const exists = await User.findOne({ email });
      if (exists)
        return res.render("tenant/auth/register-staff", {
          error: "Email already exists"
        });

      const staff = await Staff.create({
        firstName, lastName, email, role
      });

      await User.create({
        email,
        roles: [role],
        staffId: staff._id,
        status: "pending"
      });

      res.render("tenant/auth/register-success");
    } catch (err) {
      console.error(err);
      res.render("tenant/auth/register-staff", { error: "Registration failed" });
    }
  }
};
