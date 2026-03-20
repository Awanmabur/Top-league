const { getStaffProfile, renderError } = require("./_helpers");

module.exports = {
  async view(req, res) {
    try {
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      return res.render("tenant/staff/profile", {
        tenant: req.tenant,
        user,
        staff,
        error: staff ? null : "Staff profile not found. Contact admin."
      });
    } catch (err) {
      console.error("STAFF PROFILE VIEW ERROR:", err);
      return res.status(500).send("Failed to load profile");
    }
  },

  async update(req, res) {
    try {
      const { User, Staff, Department } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const firstName = String(req.body.firstName || "").trim();
      const lastName  = String(req.body.lastName || "").trim();
      const phone     = String(req.body.phone || "").trim();

      if (!firstName || !lastName) {
        return renderError(res, "tenant/staff/profile", { tenant: req.tenant, user, staff }, "First name and last name are required.");
      }

      await User?.updateOne({ _id: user._id, deletedAt: null }, {
        firstName,
        lastName,
        phone: phone || null
      }).catch(() => {});

      // Optional updates to Staff record (if present)
      if (Staff && staff) {
        let departmentId = req.body.departmentId ? String(req.body.departmentId).trim() : "";
        if (departmentId && !require("mongoose").Types.ObjectId.isValid(departmentId)) {
          departmentId = "";
        }

        const staffUpdates = {
          firstName,
          lastName,
          phone: phone || null
        };
        if (departmentId) staffUpdates.departmentId = departmentId;

        await Staff.updateOne({ _id: staff._id }, staffUpdates).catch(() => {});
      }

      return res.redirect("/staff/profile");
    } catch (err) {
      console.error("STAFF PROFILE UPDATE ERROR:", err);
      return res.status(500).send("Failed to update profile");
    }
  }
};
