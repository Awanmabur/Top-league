const { getStaffProfile } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { PayrollItem } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const items = (staff && PayrollItem)
        ? await PayrollItem.find({ staffId: staff._id }).sort({ createdAt: -1 }).limit(24).lean().catch(() => [])
        : [];

      return res.render("staff/payroll", {
        tenant: req.tenant,
        user,
        staff,
        items,
        pageTitle: "Payroll",
        error: null
      });
    } catch (err) {
      console.error("STAFF PAYROLL ERROR:", err);
      return res.status(500).send("Failed to load payroll");
    }
  }
};
