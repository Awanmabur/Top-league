const { getLecturer, renderError } = require("./_helpers");

module.exports = {
  async view(req, res) {
    try {
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      return res.render("tenant/lecturer/profile", {
        tenant: req.tenant,
        user,
        lecturer,
        error: lecturer ? null : "Lecturer profile not found. Contact admin."
      });
    } catch (err) {
      console.error("LECTURER PROFILE VIEW ERROR:", err);
      return res.status(500).send("Failed to load profile");
    }
  },

  async update(req, res) {
    try {
      const { User, Staff } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const firstName = String(req.body.firstName || "").trim();
      const lastName  = String(req.body.lastName || "").trim();
      const phone     = String(req.body.phone || "").trim();

      if (!firstName || !lastName) {
        return renderError(res, "tenant/lecturer/profile", {
          tenant: req.tenant, user, lecturer
        }, "First name and last name are required.");
      }

      await User?.updateOne({ _id: user._id, deletedAt: null }, { firstName, lastName, phone: phone || null }).catch(() => {});

      // Optional lecturer extras if you store them in Staff
      if (Staff && lecturer) {
        const office = String(req.body.office || "").trim();
        const designation = String(req.body.designation || "").trim();
        await Staff.updateOne({ _id: lecturer._id }, {
          office: office || undefined,
          designation: designation || undefined
        }).catch(() => {});
      }

      return res.redirect("/lecturer/profile");
    } catch (err) {
      console.error("LECTURER PROFILE UPDATE ERROR:", err);
      return res.status(500).send("Failed to update profile");
    }
  }
};
