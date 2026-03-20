const { getLecturer, isValidId, renderError } = require("./_helpers");

module.exports = {
  async list(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const tickets = SupportTicket
        ? await SupportTicket.find({ createdByUserId: user._id }).sort({ createdAt: -1 }).lean().catch(() => [])
        : [];

      return res.render("tenant/lecturer/support/list", {
        tenant: req.tenant,
        user,
        lecturer,
        tickets,
        error: null
      });
    } catch (err) {
      console.error("LECTURER SUPPORT LIST ERROR:", err);
      return res.status(500).send("Failed to load support tickets");
    }
  },

  async newForm(req, res) {
    const { user, lecturer } = await getLecturer(req);
    if (!user) return res.redirect("/login");
    return res.render("tenant/lecturer/support/new", {
      tenant: req.tenant,
      user,
      lecturer,
      error: null,
      values: {}
    });
  },

  async create(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");
      if (!SupportTicket) return res.status(500).send("SupportTicket model missing");

      const subject = String(req.body.subject || "").trim();
      const message = String(req.body.message || "").trim();

      if (!subject || !message) {
        return renderError(res, "tenant/lecturer/support/new", {
          tenant: req.tenant, user, lecturer, values: req.body
        }, "Subject and message are required.");
      }

      const ticket = await SupportTicket.create({
        createdByUserId: user._id,
        subject,
        status: "open",
        messages: [{ from: "lecturer", message, at: new Date() }],
        createdAt: new Date()
      });

      return res.redirect(`/lecturer/support/${ticket._id}`);
    } catch (err) {
      console.error("LECTURER SUPPORT CREATE ERROR:", err);
      return res.status(500).send("Failed to create ticket");
    }
  },

  async view(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const id = req.params.id;
      if (!SupportTicket || !isValidId(id)) return res.status(404).send("Not found");

      const ticket = await SupportTicket.findOne({ _id: id, createdByUserId: user._id }).lean().catch(() => null);
      if (!ticket) return res.status(404).send("Not found");

      return res.render("tenant/lecturer/support/view", {
        tenant: req.tenant,
        user,
        lecturer,
        ticket,
        error: null
      });
    } catch (err) {
      console.error("LECTURER SUPPORT VIEW ERROR:", err);
      return res.status(500).send("Failed to load ticket");
    }
  },

  async reply(req, res) {
    try {
      const { SupportTicket } = req.models || {};
      const { user } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      const id = req.params.id;
      if (!SupportTicket || !isValidId(id)) return res.status(404).send("Not found");

      const message = String(req.body.message || "").trim();
      if (!message) return res.redirect(`/lecturer/support/${id}`);

      await SupportTicket.updateOne(
        { _id: id, createdByUserId: user._id },
        { $push: { messages: { from: "lecturer", message, at: new Date() } } }
      ).catch(() => {});

      return res.redirect(`/lecturer/support/${id}`);
    } catch (err) {
      console.error("LECTURER SUPPORT REPLY ERROR:", err);
      return res.status(500).send("Failed to reply");
    }
  }
};
