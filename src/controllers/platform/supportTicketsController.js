const { platformConnection } = require("../../config/db");
const SupportTicket = require("../../models/platform/SupportTicket")(platformConnection);
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);
const { platformCan } = require("../../utils/platformAccess");
const support = require("../../services/platformSupportService");

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: "SupportTicket",
      entityId: payload.entityId ? String(payload.entityId) : "",
      tenantId: payload.tenantId || null,
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("Support ticket audit log failed:", err);
  }
}

async function loadTenantOptions() {
  return Tenant.find({ isDeleted: { $ne: true } }).select("name code status").sort({ name: 1 }).lean();
}

async function loadSupportAgents() {
  const users = await PlatformUser.find({ isDeleted: { $ne: true }, isActive: true })
    .select("firstName lastName name email role")
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  return users.filter((user) => platformCan(user.role, "support.manage"));
}

module.exports = {
  listSupportTickets: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const requestedStatus = support.text(req.query.status, 32).toLowerCase();
      const requestedPriority = support.text(req.query.priority, 32).toLowerCase();
      const status = support.STATUSES.has(requestedStatus) ? requestedStatus : "";
      const priority = support.PRIORITIES.has(requestedPriority) ? requestedPriority : "";
      const filter = {};
      if (status) filter.status = status;
      if (priority) filter.priority = priority;

      const tickets = await SupportTicket.find(filter)
        .populate("tenantId", "name code status")
        .populate("assignedTo", "name firstName lastName email role")
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();
      return res.render("platform/support-tickets/index", { tickets, filters: { status, priority }, error: null });
    } catch (err) {
      console.error("listSupportTickets error:", err);
      return res.status(500).render("platform/support-tickets/index", { tickets: [], filters: { status: "", priority: "" }, error: "Failed to load support tickets." });
    }
  },

  createSupportTicketForm: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.render("platform/support-tickets/create", { tenants: await loadTenantOptions(), old: {}, error: null });
    } catch (err) {
      return res.status(500).render("platform/support-tickets/create", { tenants: [], old: {}, error: "Failed to load support ticket form." });
    }
  },

  createSupportTicket: async (req, res) => {
    try {
      const tenantId = support.text(req.body.tenantId, 80);
      const subject = support.text(req.body.subject, 220);
      const message = support.text(req.body.message, 5000);
      if (!tenantId || !subject || !message) throw new Error("Tenant, subject and message are required.");

      const tenant = await Tenant.findOne({ _id: tenantId, isDeleted: { $ne: true } }).select("_id name").lean();
      if (!tenant) throw new Error("Selected tenant does not exist.");

      const ticket = await SupportTicket.create({
        ticketNo: support.ticketNumber(),
        tenantId: tenant._id,
        subject,
        category: support.normalizeCategory(req.body.category),
        priority: support.normalizePriority(req.body.priority),
        requesterName: support.text(req.body.requesterName, 120),
        requesterEmail: support.validateRequesterEmail(req.body.requesterEmail),
        messages: [{ senderType: "platform", senderName: req.user?.name || "Platform Admin", senderEmail: req.user?.email || "", body: message }],
        createdByTenant: false,
        revision: 1,
        statusHistory: [{ at: new Date(), fromStatus: "", toStatus: "open", actorId: req.user?._id || null, note: "Ticket created", revision: 1 }],
      });

      await writeAudit(req, { action: "Create Support Ticket", entityId: ticket._id, tenantId: ticket.tenantId, description: `Created support ticket ${ticket.ticketNo}` });
      return res.redirect("/super-admin/support-tickets");
    } catch (err) {
      const tenants = await loadTenantOptions().catch(() => []);
      return res.status(400).render("platform/support-tickets/create", { tenants, old: req.body, error: err?.message || "Failed to create support ticket." });
    }
  },

  showSupportTicket: async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const [ticket, agents] = await Promise.all([
        SupportTicket.findById(req.params.id).populate("tenantId", "name code status").populate("assignedTo", "name firstName lastName email role").lean(),
        loadSupportAgents(),
      ]);
      if (!ticket) return res.status(404).render("platform/support-tickets/show", { ticket: null, agents, error: "Support ticket not found." });
      return res.render("platform/support-tickets/show", { ticket, agents, error: null });
    } catch (err) {
      return res.status(500).render("platform/support-tickets/show", { ticket: null, agents: [], error: "Failed to load support ticket." });
    }
  },

  assignSupportTicket: async (req, res) => {
    try {
      const revision = support.positiveRevision(req.body.revision);
      const assignedTo = support.text(req.body.assignedTo, 80) || null;
      if (assignedTo) {
        const agent = await PlatformUser.findOne({ _id: assignedTo, isDeleted: { $ne: true }, isActive: true }).select("role").lean();
        if (!agent || !platformCan(agent.role, "support.manage")) throw new Error("Selected assignee is not an active support operator.");
      }
      const ticket = await SupportTicket.findOneAndUpdate(
        { _id: req.params.id, revision },
        { $set: { assignedTo }, $inc: { revision: 1 } },
        { new: true, runValidators: true },
      );
      if (!ticket) return res.status(409).send("Support ticket changed in another session. Reload and try again.");
      await writeAudit(req, { action: "Assign Support Ticket", entityId: ticket._id, tenantId: ticket.tenantId, description: `Assigned ticket ${ticket.ticketNo}`, meta: { assignedTo } });
      return res.redirect(`/super-admin/support-tickets/${ticket._id}`);
    } catch (err) {
      return res.status(400).send(err?.message || "Failed to assign support ticket.");
    }
  },

  updateSupportTicketStatus: async (req, res) => {
    try {
      const revision = support.positiveRevision(req.body.revision);
      const nextStatus = support.normalizeStatus(req.body.status, "");
      if (!nextStatus) throw new Error("Invalid support ticket status.");
      const current = await SupportTicket.findOne({ _id: req.params.id, revision }).select("ticketNo tenantId status resolvedAt closedAt revision").lean();
      if (!current) return res.status(409).send("Support ticket changed in another session. Reload and try again.");
      support.assertStatusTransition(current.status, nextStatus);
      if (current.status === nextStatus) return res.redirect(`/super-admin/support-tickets/${current._id}`);

      const nextRevision = revision + 1;
      const set = { status: nextStatus, ...support.statusDates(current.status, nextStatus, current) };
      const ticket = await SupportTicket.findOneAndUpdate(
        { _id: current._id, revision, status: current.status },
        {
          $set: set,
          $inc: { revision: 1 },
          $push: { statusHistory: { at: new Date(), fromStatus: current.status, toStatus: nextStatus, actorId: req.user?._id || null, note: support.text(req.body.note, 500), revision: nextRevision } },
        },
        { new: true, runValidators: true },
      );
      if (!ticket) return res.status(409).send("Support ticket changed in another session. Reload and try again.");
      await writeAudit(req, { action: "Update Support Ticket Status", entityId: ticket._id, tenantId: ticket.tenantId, description: `Changed ticket ${ticket.ticketNo} status to ${ticket.status}`, meta: { fromStatus: current.status, status: ticket.status, revision: ticket.revision } });
      return res.redirect(`/super-admin/support-tickets/${ticket._id}`);
    } catch (err) {
      return res.status(400).send(err?.message || "Failed to update support ticket status.");
    }
  },

  replySupportTicket: async (req, res) => {
    try {
      const revision = support.positiveRevision(req.body.revision);
      const body = support.text(req.body.body, 5000);
      if (!body) throw new Error("Reply body is required.");
      const current = await SupportTicket.findOne({ _id: req.params.id, revision }).select("ticketNo tenantId status firstResponseAt revision messages").lean();
      if (!current) return res.status(409).send("Support ticket changed in another session. Reload and try again.");
      if (["resolved", "closed"].includes(current.status)) throw new Error("Reopen this ticket before replying.");
      if (Array.isArray(current.messages) && current.messages.length >= 500) throw new Error("This ticket reached the maximum message history. Open a follow-up ticket.");

      const nextStatus = current.status === "open" ? "pending" : current.status;
      const set = {};
      if (!current.firstResponseAt) set.firstResponseAt = new Date();
      if (nextStatus !== current.status) set.status = nextStatus;
      const update = {
        $push: { messages: { senderType: "platform", senderName: req.user?.name || "Platform Admin", senderEmail: req.user?.email || "", body } },
        $inc: { revision: 1 },
      };
      if (Object.keys(set).length) update.$set = set;
      if (nextStatus !== current.status) {
        update.$push.statusHistory = { at: new Date(), fromStatus: current.status, toStatus: nextStatus, actorId: req.user?._id || null, note: "Platform reply", revision: revision + 1 };
      }

      const ticket = await SupportTicket.findOneAndUpdate({ _id: current._id, revision, status: current.status }, update, { new: true, runValidators: true });
      if (!ticket) return res.status(409).send("Support ticket changed in another session. Reload and try again.");
      await writeAudit(req, { action: "Reply Support Ticket", entityId: ticket._id, tenantId: ticket.tenantId, description: `Replied to ticket ${ticket.ticketNo}`, meta: { revision: ticket.revision } });
      return res.redirect(`/super-admin/support-tickets/${ticket._id}`);
    } catch (err) {
      return res.status(400).send(err?.message || "Failed to reply to support ticket.");
    }
  },
};
