const { getStaffProfile, renderError } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { LeaveRequest } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const items = (staff && LeaveRequest)
        ? await LeaveRequest.find({ staffId: staff._id }).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/staff/leave/list", {
        tenant: req.tenant,
        user,
        staff,
        items,
        error: null
      });
    } catch (err) {
      console.error("STAFF LEAVE LIST ERROR:", err);
      return res.status(500).send("Failed to load leave requests");
    }
  },

  async newForm(req, res) {
    const { user, staff } = await getStaffProfile(req);
    if (!user) return res.redirect("/login");
    return res.render("tenant/staff/leave/new", {
      tenant: req.tenant,
      user,
      staff,
      error: null,
      values: {}
    });
  },

  async create(req, res) {
    try {
      const { LeaveRequest } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");
      if (!LeaveRequest || !staff) return res.status(500).send("LeaveRequest model missing");

      const from = req.body.from ? new Date(req.body.from) : null;
      const to = req.body.to ? new Date(req.body.to) : null;
      const reason = String(req.body.reason || "").trim();

      if (!from || !to || !reason) {
        return renderError(res, "tenant/staff/leave/new", { tenant: req.tenant, user, staff, values: req.body }, "From, To and Reason are required.");
      }

      await LeaveRequest.create({
        staffId: staff._id,
        from,
        to,
        reason,
        status: "pending",
        createdAt: new Date()
      });

      return res.redirect("/staff/leave");
    } catch (err) {
      console.error("STAFF LEAVE CREATE ERROR:", err);
      return res.status(500).send("Failed to submit leave request");
    }
  }
};
