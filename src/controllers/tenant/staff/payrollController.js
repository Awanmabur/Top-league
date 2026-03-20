const { getStaffProfile } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { Payslip } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const items = (staff && Payslip)
        ? await Payslip.find({ staffId: staff._id }).sort({ period: -1 }).limit(24).lean().catch(() => [])
        : [];

      return res.render("tenant/staff/payroll", {
        tenant: req.tenant,
        user,
        staff,
        items,
        error: null
      });
    } catch (err) {
      console.error("STAFF PAYROLL ERROR:", err);
      return res.status(500).send("Failed to load payroll");
    }
  }
};
