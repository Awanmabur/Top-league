const mongoose = require("mongoose");
const {
  createTicket,
  addThreadMessage,
  applyStatus,
  normalizeCategory,
  normalizePriority,
  refreshStats,
} = require("../../../services/tenant/helpdeskService");

const actorUserId = (req) => req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const str = (v) => String(v ?? "").trim();
const escapeRegex = (v) => str(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function serializeTicket(doc) {
  return {
    id: String(doc._id),
    ticketNo: doc.ticketNo || "",
    subject: doc.subject || "",
    category: doc.category || "General",
    requesterType: doc.requesterType || "External",
    requesterName: doc.requesterName || "",
    requesterEmail: doc.requesterEmail || "",
    assignedTo: doc.assignedTo || "",
    priority: doc.priority || "Medium",
    status: doc.status || "Open",
    description: doc.description || "",
    dueDate: formatDateTime(doc.dueDate),
    dueDateRaw: doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 16) : "",
    slaHours: Number(doc.slaHours || 0),
    stats: {
      replies: Number(doc.stats?.replies || 0),
      firstResponse: doc.stats?.firstResponse || "—",
      resolutionTime: doc.stats?.resolutionTime || "—",
      slaBreached: !!doc.stats?.slaBreached,
    },
    thread: Array.isArray(doc.thread)
      ? doc.thread.map((r) => ({
          id: String(r._id),
          author: r.author || "",
          role: r.role || "",
          body: r.body || "",
          createdAt: formatDateTime(r.createdAt),
        }))
      : [],
  };
}

function computeKpis(list = []) {
  const now = new Date();
  return {
    open: list.filter((x) => x.status === "Open").length,
    inProgress: list.filter((x) => x.status === "In Progress").length,
    resolved: list.filter((x) => x.status === "Resolved").length,
    overdue: list.filter((x) => {
      if (!x.dueDateRaw) return false;
      const d = new Date(x.dueDateRaw);
      return !Number.isNaN(d.getTime()) && d < now && !["Resolved", "Closed"].includes(x.status);
    }).length,
  };
}

function buildQuery(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const category = str(query.category || "all");
  const priority = str(query.priority || "all");
  const filter = { isDeleted: { $ne: true } };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { ticketNo: rx }, { subject: rx }, { description: rx }, { category: rx },
      { requesterName: rx }, { requesterEmail: rx }, { status: rx },
    ];
  }
  if (status !== "all") filter.status = status;
  if (category !== "all") filter.category = category;
  if (priority !== "all") filter.priority = priority;
  return { filter, display: { q, status, category, priority } };
}

async function actorName(req) {
  const direct = str(req.user?.fullName || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") || req.user?.email);
  if (direct) return direct;
  const id = actorUserId(req);
  const User = req.models?.User;
  if (!id || !User) return "Support Team";
  const user = await User.findById(id).select("firstName lastName fullName email").lean().catch(() => null);
  return str(user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Support Team");
}

function csvCell(v) {
  const text = String(v ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  index: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    const { filter, display } = buildQuery(req.query);
    const tickets = await HelpdeskTicket.find(filter).sort({ createdAt: -1 }).lean();
    const data = tickets.map(serializeTicket);
    return res.render("tenant/helpdesk/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      tickets: data,
      kpis: computeKpis(data),
      query: display,
    });
  },

  create: async (req, res) => {
    try {
      const actorId = actorUserId(req);
      await createTicket(req.models, {
        subject: req.body.subject,
        description: req.body.description,
        category: req.body.category,
        priority: req.body.priority,
        requesterType: "External",
        requesterName: req.body.requesterName,
        requesterEmail: req.body.requesterEmail,
        assignedTo: req.body.assignedTo,
        status: req.body.status || "Open",
        dueDate: asDate(req.body.dueDate),
        slaHours: req.body.slaHours,
        actorUserId: actorId,
        authorName: await actorName(req),
        adminCreated: true,
      });
      req.flash?.("success", "Ticket created successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to create ticket.");
    }
    return res.redirect("/admin/helpdesk");
  },

  update: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid ticket ID.");
      return res.redirect("/admin/helpdesk");
    }
    try {
      const item = await HelpdeskTicket.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!item) throw new Error("Ticket not found.");
      const subject = str(req.body.subject);
      const description = str(req.body.description);
      if (!subject || !description) throw new Error("Subject and description are required.");

      item.subject = subject;
      item.description = description;
      item.category = normalizeCategory(req.body.category);
      item.requesterName = str(req.body.requesterName);
      item.requesterEmail = str(req.body.requesterEmail).toLowerCase();
      item.assignedTo = str(req.body.assignedTo);
      item.priority = normalizePriority(req.body.priority);
      item.dueDate = asDate(req.body.dueDate);
      item.slaHours = Math.max(0, Number(req.body.slaHours || 0) || 0);
      item.updatedBy = actorUserId(req);
      if (str(req.body.status) && str(req.body.status) !== item.status) applyStatus(item, req.body.status);
      refreshStats(item);
      await item.save();
      req.flash?.("success", "Ticket updated successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to update ticket.");
    }
    return res.redirect("/admin/helpdesk");
  },

  reply: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.status(404).send("Not found");
    try {
      const item = await HelpdeskTicket.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!item) throw new Error("Ticket not found.");
      await addThreadMessage(req.models, item, {
        role: "Staff",
        authorUserId: actorUserId(req),
        authorName: await actorName(req),
        body: req.body.message,
      });
      req.flash?.("success", "Reply sent successfully.");
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to send reply.");
    }
    return res.redirect("/admin/helpdesk");
  },

  progress: async (req, res) => module.exports.setStatus(req, res, "In Progress"),
  resolve: async (req, res) => module.exports.setStatus(req, res, "Resolved"),
  close: async (req, res) => module.exports.setStatus(req, res, "Closed"),

  setStatus: async (req, res, status) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/helpdesk");
    try {
      const item = await HelpdeskTicket.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
      if (!item) throw new Error("Ticket not found.");
      applyStatus(item, status);
      item.updatedBy = actorUserId(req);
      await item.save();
      req.flash?.("success", `Ticket moved to ${status}.`);
    } catch (err) {
      req.flash?.("error", err?.message || "Failed to update ticket status.");
    }
    return res.redirect("/admin/helpdesk");
  },

  delete: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/helpdesk");
    await HelpdeskTicket.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );
    req.flash?.("success", "Ticket removed.");
    return res.redirect("/admin/helpdesk");
  },

  bulkAction: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    const ids = String(req.body.ids || "").split(",").map((x) => x.trim()).filter(isValidId);
    const action = str(req.body.action);
    const status = action === "progress" ? "In Progress" : action === "resolve" ? "Resolved" : action === "close" ? "Closed" : "";
    if (!ids.length || !status) return res.redirect("/admin/helpdesk");

    const docs = await HelpdeskTicket.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
    let changed = 0;
    for (const item of docs) {
      try {
        applyStatus(item, status);
        item.updatedBy = actorUserId(req);
        await item.save();
        changed += 1;
      } catch (_) {
        // Closed tickets are deliberately skipped because Closed is terminal.
      }
    }
    req.flash?.("success", `${changed} ticket${changed === 1 ? "" : "s"} updated.`);
    return res.redirect("/admin/helpdesk");
  },

  exportCsv: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    const { filter } = buildQuery(req.query);
    const rows = await HelpdeskTicket.find(filter).sort({ createdAt: -1 }).lean();
    const header = ["Ticket No", "Subject", "Category", "Requester Type", "Requester", "Email", "Assigned To", "Priority", "Status", "Replies", "First Response", "Resolution Time", "Created At", "Updated At"];
    const lines = [header.map(csvCell).join(",")];
    rows.forEach((row) => {
      lines.push([
        row.ticketNo, row.subject, row.category, row.requesterType, row.requesterName, row.requesterEmail,
        row.assignedTo, row.priority, row.status, row.stats?.replies || 0, row.stats?.firstResponse || "—",
        row.stats?.resolutionTime || "—", row.createdAt?.toISOString?.() || row.createdAt || "", row.updatedAt?.toISOString?.() || row.updatedAt || "",
      ].map(csvCell).join(","));
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="helpdesk-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  },

  templates: async (req, res) => {
    const { HelpdeskTemplate } = req.models;
    const templates = await HelpdeskTemplate.find({ isDeleted: { $ne: true } }).sort({ updatedAt: -1 }).lean();
    return res.render("tenant/helpdesk/templates", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      templates,
      success: req.flash?.("success") || [],
      error: req.flash?.("error") || [],
    });
  },

  createTemplate: async (req, res) => {
    const { HelpdeskTemplate } = req.models;
    try {
      await HelpdeskTemplate.create({
        name: str(req.body.name),
        subject: str(req.body.subject),
        body: str(req.body.body),
        category: normalizeCategory(req.body.category),
        priority: normalizePriority(req.body.priority),
        createdBy: actorUserId(req),
        updatedBy: actorUserId(req),
      });
      req.flash?.("success", "Helpdesk template created.");
    } catch (err) {
      req.flash?.("error", err?.code === 11000 ? "A template with that name already exists." : (err?.message || "Failed to create template."));
    }
    return res.redirect("/admin/helpdesk/templates");
  },

  deleteTemplate: async (req, res) => {
    const { HelpdeskTemplate } = req.models;
    if (isValidId(req.params.id)) {
      await HelpdeskTemplate.updateOne(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
      );
      req.flash?.("success", "Template removed.");
    }
    return res.redirect("/admin/helpdesk/templates");
  },
};
