const { platformConnection } = require("../../config/db");

const SupportTicket = require("../../models/platform/SupportTicket")(platformConnection);
const Tenant = require("../../models/platform/Tenant")(platformConnection);
const PlatformUser = require("../../models/platform/PlatformUser")(platformConnection);
const AuditLog = require("../../models/platform/AuditLog")(platformConnection);

function safeTrim(v) {
  return String(v || "").trim();
}

async function writeAudit(req, payload) {
  try {
    await AuditLog.create({
      actorId: req.user?._id || null,
      actorName: req.user?.name || "",
      actorRole: req.user?.role || "",
      action: payload.action,
      entityType: payload.entityType || "SupportTicket",
      entityId: payload.entityId ? String(payload.entityId) : "",
      tenantId: payload.tenantId || null,
      description: payload.description || "",
      ipAddress: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      meta: payload.meta || {},
    });
  } catch (err) {
    console.error("❌ support ticket audit log failed:", err);
  }
}

module.exports = {
  listSupportTickets: async (req, res) => {
    try {
      const { status = "", priority = "" } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (priority) filter.priority = priority;

      const tickets = await SupportTicket.find(filter)
        .populate("tenantId")
        .populate("assignedTo")
        .sort({ createdAt: -1 })
        .lean();

      return res.render("platform/support-tickets/index", {
        tickets,
        filters: { status, priority },
        error: null,
      });
    } catch (err) {
      console.error("❌ listSupportTickets error:", err);
      return res.status(500).render("platform/support-tickets/index", {
        tickets: [],
        filters: { status: "", priority: "" },
        error: "Failed to load support tickets.",
      });
    }
  },

  createSupportTicketForm: async (req, res) => {
    try {
      const tenants = await Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();

      return res.render("platform/support-tickets/create", {
        tenants,
        old: {},
        error: null,
      });
    } catch (err) {
      console.error("❌ createSupportTicketForm error:", err);
      return res.status(500).render("platform/support-tickets/create", {
        tenants: [],
        old: {},
        error: "Failed to load support ticket form.",
      });
    }
  },

  createSupportTicket: async (req, res) => {
    try {
      const {
        ticketNo,
        tenantId,
        subject,
        category,
        priority,
        requesterName,
        requesterEmail,
        message,
      } = req.body;

      if (!tenantId || !safeTrim(subject) || !safeTrim(message)) {
        const tenants = await Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();

        return res.status(400).render("platform/support-tickets/create", {
          tenants,
          old: req.body,
          error: "Tenant, subject and message are required.",
        });
      }

      const ticket = await SupportTicket.create({
        ticketNo: safeTrim(ticketNo) || `TKT-${Date.now()}`,
        tenantId,
        subject: safeTrim(subject),
        category: safeTrim(category || "technical"),
        priority: safeTrim(priority || "medium"),
        requesterName: safeTrim(requesterName),
        requesterEmail: safeTrim(requesterEmail).toLowerCase(),
        messages: [
          {
            senderType: "platform",
            senderName: req.user?.name || "Platform Admin",
            senderEmail: req.user?.email || "",
            body: safeTrim(message),
          },
        ],
        createdByTenant: false,
      });

      await writeAudit(req, {
        action: "Create Support Ticket",
        entityId: ticket._id,
        tenantId: ticket.tenantId,
        description: `Created support ticket ${ticket.ticketNo}`,
      });

      return res.redirect("/super-admin/support-tickets");
    } catch (err) {
      console.error("❌ createSupportTicket error:", err);

      const tenants = await Tenant.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();

      return res.status(500).render("platform/support-tickets/create", {
        tenants,
        old: req.body,
        error: err?.message || "Failed to create support ticket.",
      });
    }
  },

  showSupportTicket: async (req, res) => {
    try {
      const [ticket, agents] = await Promise.all([
        SupportTicket.findById(req.params.id)
          .populate("tenantId")
          .populate("assignedTo")
          .lean(),
        PlatformUser.find({
          isDeleted: { $ne: true },
          isActive: true,
        })
          .sort({ firstName: 1, lastName: 1 })
          .lean(),
      ]);

      if (!ticket) {
        return res.status(404).render("platform/support-tickets/show", {
          ticket: null,
          agents,
          error: "Support ticket not found.",
        });
      }

      return res.render("platform/support-tickets/show", {
        ticket,
        agents,
        error: null,
      });
    } catch (err) {
      console.error("❌ showSupportTicket error:", err);
      return res.status(500).render("platform/support-tickets/show", {
        ticket: null,
        agents: [],
        error: "Failed to load support ticket.",
      });
    }
  },

  assignSupportTicket: async (req, res) => {
    try {
      const ticket = await SupportTicket.findById(req.params.id);

      if (!ticket) {
        return res.status(404).send("Support ticket not found.");
      }

      ticket.assignedTo = req.body.assignedTo || null;
      await ticket.save();

      await writeAudit(req, {
        action: "Assign Support Ticket",
        entityId: ticket._id,
        tenantId: ticket.tenantId,
        description: `Assigned ticket ${ticket.ticketNo}`,
        meta: { assignedTo: req.body.assignedTo || null },
      });

      return res.redirect(`/super-admin/support-tickets/${ticket._id}`);
    } catch (err) {
      console.error("❌ assignSupportTicket error:", err);
      return res.status(500).send("Failed to assign support ticket.");
    }
  },

  updateSupportTicketStatus: async (req, res) => {
    try {
      const ticket = await SupportTicket.findById(req.params.id);

      if (!ticket) {
        return res.status(404).send("Support ticket not found.");
      }

      const nextStatus = safeTrim(req.body.status);
      if (!["open", "pending", "resolved", "closed"].includes(nextStatus)) {
        return res.status(400).send("Invalid support ticket status.");
      }

      ticket.status = nextStatus;

      if (nextStatus === "resolved" && !ticket.resolvedAt) {
        ticket.resolvedAt = new Date();
      }
      if (nextStatus === "closed" && !ticket.closedAt) {
        ticket.closedAt = new Date();
      }

      await ticket.save();

      await writeAudit(req, {
        action: "Update Support Ticket Status",
        entityId: ticket._id,
        tenantId: ticket.tenantId,
        description: `Changed ticket ${ticket.ticketNo} status to ${ticket.status}`,
        meta: { status: ticket.status },
      });

      return res.redirect(`/super-admin/support-tickets/${ticket._id}`);
    } catch (err) {
      console.error("❌ updateSupportTicketStatus error:", err);
      return res.status(500).send("Failed to update support ticket status.");
    }
  },

  replySupportTicket: async (req, res) => {
    try {
      const ticket = await SupportTicket.findById(req.params.id);

      if (!ticket) {
        return res.status(404).send("Support ticket not found.");
      }

      const body = safeTrim(req.body.body);
      if (!body) {
        return res.status(400).send("Reply body is required.");
      }

      ticket.messages.push({
        senderType: "platform",
        senderName: req.user?.name || "Platform Admin",
        senderEmail: req.user?.email || "",
        body,
      });

      if (!ticket.firstResponseAt) {
        ticket.firstResponseAt = new Date();
      }

      if (ticket.status === "open") {
        ticket.status = "pending";
      }

      await ticket.save();

      await writeAudit(req, {
        action: "Reply Support Ticket",
        entityId: ticket._id,
        tenantId: ticket.tenantId,
        description: `Replied to ticket ${ticket.ticketNo}`,
      });

      return res.redirect(`/super-admin/support-tickets/${ticket._id}`);
    } catch (err) {
      console.error("❌ replySupportTicket error:", err);
      return res.status(500).send("Failed to reply to support ticket.");
    }
  },
};