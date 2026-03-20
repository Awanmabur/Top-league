const { getStaffProfile, isValidId, renderError } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const tickets = SupportTicket
        ? await SupportTicket.find({ createdByUserId: user._id }).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/staff/support/list", {
        tenant: req.tenant,
        user,
        staff,
        tickets,
        error: null
      });
    } catch (err) {
      console.error("STAFF SUPPORT LIST ERROR:", err);
      return res.status(500).send("Failed to load support tickets");
    }
  },

  async newForm(req, res) {
    const { user, staff } = await getStaffProfile(req);
    if (!user) return res.redirect("/login");
    return res.render("tenant/staff/support/new", {
      tenant: req.tenant,
      user,
      staff,
      error: null,
      values: {}
    });
  },

  async create(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");
      if (!SupportTicket) return res.status(500).send("SupportTicket model missing");

      const subject = String(req.body.subject || "").trim();
      const message = String(req.body.message || "").trim();

      if (!subject || !message) {
        return renderError(res, "tenant/staff/support/new", { tenant: req.tenant, user, staff, values: req.body }, "Subject and message are required.");
      }

      const ticket = await SupportTicket.create({
        createdByUserId: user._id,
        subject,
        status: "open",
        messages: [{ from: "staff", message, at: new Date() }],
        createdAt: new Date()
      });

      return res.redirect(`/staff/support/${ticket._id}`);
    } catch (err) {
      console.error("STAFF SUPPORT CREATE ERROR:", err);
      return res.status(500).send("Failed to create ticket");
    }
  },

  async view(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const id = req.params.id;
      if (!SupportTicket || !isValidId(id)) return res.status(404).send("Not found");

      const ticket = await SupportTicket.findOne({ _id: id, createdByUserId: user._id }).lean().catch(() => null);
      if (!ticket) return res.status(404).send("Not found");

      return res.render("tenant/staff/support/view", {
        tenant: req.tenant,
        user,
        staff,
        ticket,
        error: null
      });
    } catch (err) {
      console.error("STAFF SUPPORT VIEW ERROR:", err);
      return res.status(500).send("Failed to load ticket");
    }
  },

  async reply(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const id = req.params.id;
      if (!SupportTicket || !isValidId(id)) return res.status(404).send("Not found");

      const message = String(req.body.message || "").trim();
      if (!message) return res.redirect(`/staff/support/${id}`);

      await SupportTicket.updateOne(
        { _id: id, createdByUserId: user._id },
        { $push: { messages: { from: "staff", message, at: new Date() } } }
      ).catch(() => {});

      return res.redirect(`/staff/support/${id}`);
    } catch (err) {
      console.error("STAFF SUPPORT REPLY ERROR:", err);
      return res.status(500).send("Failed to reply");
    }
  }
};
