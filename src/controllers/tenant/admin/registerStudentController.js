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

      const exists = await User.findOne({ email });
      if (exists)
        return res.render("tenant/auth/register-student", {
          error: "Email is already registered", programs: []
        });

      const student = await Student.create({
        firstName, lastName, email, phone, programId
      });

      await User.create({
        email,
        roles: ["student"],
        studentId: student._id,
        status: "pending"
      });

      res.render("tenant/auth/register-success");
    } catch (err) {
      console.error(err);
      res.render("tenant/auth/register-student", { error: "Registration failed", programs: [] });
    }
  }
};
