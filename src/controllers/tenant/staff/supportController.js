const { getStaffProfile, isValidId, renderError } = require("./_helpers");
const {
  createTicket,
  addThreadMessage,
  requesterDisplayName,
} = require("../../../services/tenant/helpdeskService");

function presentTicket(ticket) {
  if (!ticket) return ticket;
  const row = typeof ticket.toObject === "function" ? ticket.toObject() : { ...ticket };
  row.messages = Array.isArray(row.thread) ? row.thread.map((m) => ({
    from: m.author || (m.role === "Staff" ? "Support" : "Requester"),
    message: m.body || "",
    at: m.createdAt || null,
  })) : [];
  return row;
}

module.exports = {
  async list(req, res) {
    try {
      const { HelpdeskTicket } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const tickets = await HelpdeskTicket.find({
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      }).sort({ updatedAt: -1, createdAt: -1 }).lean();

      return res.render("staff/support", {
        tenant: req.tenant,
        user,
        staff,
        pageTitle: "Support",
        mode: "list",
        tickets,
        error: null,
      });
    } catch (err) {
      console.error("STAFF SUPPORT LIST ERROR:", err);
      return res.status(500).send("Failed to load support tickets");
    }
  },

  async newForm(req, res) {
    const { user, staff } = await getStaffProfile(req);
    if (!user) return res.redirect("/login");
    return res.render("staff/support", {
      tenant: req.tenant,
      user,
      staff,
      pageTitle: "Support",
      mode: "new",
      error: null,
      values: {},
    });
  },

  async create(req, res) {
    try {
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");

      const subject = String(req.body.subject || "").trim();
      const message = String(req.body.message || "").trim();
      if (!subject || !message) {
        return renderError(res, "staff/support", {
          tenant: req.tenant, user, staff, pageTitle: "Support", mode: "new", values: req.body,
        }, "Subject and message are required.");
      }

      const ticket = await createTicket(req.models, {
        subject,
        description: message,
        category: req.body.category || "General",
        priority: req.body.priority || "Medium",
        requesterUserId: user._id,
        requesterType: "Staff",
        requesterName: requesterDisplayName(user, staff, "Staff"),
        requesterEmail: user.email || staff?.email || "",
        actorUserId: user._id,
        authorName: requesterDisplayName(user, staff, "Staff"),
      });
      return res.redirect(`/staff/support/${ticket._id}`);
    } catch (err) {
      console.error("STAFF SUPPORT CREATE ERROR:", err);
      return res.status(500).send("Failed to create ticket");
    }
  },

  async view(req, res) {
    try {
      const { HelpdeskTicket } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");
      const id = req.params.id;
      if (!HelpdeskTicket || !isValidId(id)) return res.status(404).send("Not found");

      const ticket = await HelpdeskTicket.findOne({
        _id: id,
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      }).lean();
      if (!ticket) return res.status(404).send("Not found");

      return res.render("staff/support", {
        tenant: req.tenant,
        user,
        staff,
        pageTitle: "Support",
        mode: "view",
        ticket: presentTicket(ticket),
        error: null,
      });
    } catch (err) {
      console.error("STAFF SUPPORT VIEW ERROR:", err);
      return res.status(500).send("Failed to load ticket");
    }
  },

  async reply(req, res) {
    try {
      const { HelpdeskTicket } = req.models || {};
      const { user, staff } = await getStaffProfile(req);
      if (!user) return res.redirect("/login");
      const id = req.params.id;
      if (!HelpdeskTicket || !isValidId(id)) return res.status(404).send("Not found");

      const ticket = await HelpdeskTicket.findOne({
        _id: id,
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      });
      if (!ticket) return res.status(404).send("Not found");

      await addThreadMessage(req.models, ticket, {
        role: "Requester",
        authorUserId: user._id,
        authorName: requesterDisplayName(user, staff, "Staff"),
        body: req.body.message,
      });
      return res.redirect(`/staff/support/${id}`);
    } catch (err) {
      console.error("STAFF SUPPORT REPLY ERROR:", err);
      return res.status(400).send(err?.message || "Failed to reply");
    }
  },
};
