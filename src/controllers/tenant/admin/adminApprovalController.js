module.exports = {
  async pending(req, res) {
    const { User, Student, Staff } = req.models;

    const pendingUsers = await User.find({ status: "pending" });

    res.render("tenant/admin/pending-users", { pendingUsers });
  },

  async approve(req, res) {
    const { User } = req.models;
    const crypto = require("crypto");
    const bcrypt = require("bcrypt");

    const user = await User.findById(req.params.id);

    if (!user) return res.redirect("/admin/pending-users");

    // auto-generate password
    const password = crypto.randomBytes(4).toString("hex");
    const hash = await bcrypt.hash(password, 12);

    user.passwordHash = hash;
    user.status = "active";
    await user.save();

    if (process.env.DEBUG_AUTH_TOKENS === "1") {
      console.log("User approved with password:", password);
    }

    // TODO: send email here

    res.redirect("/admin/pending-users");
  },

  async reject(req, res) {
    const { User } = req.models;
    await User.findByIdAndDelete(req.params.id);
    res.redirect("/admin/pending-users");
  }
};
