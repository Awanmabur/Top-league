const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const str = (v) => String(v ?? "").trim();

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

module.exports = {
  index: async (req, res) => {
    const { HelpdeskTicket } = req.models;

    const q = str(req.query.q);
    const status = str(req.query.status || "all");
    const category = str(req.query.category || "all");
    const priority = str(req.query.priority || "all");

    const query = { isDeleted: { $ne: true } };

    if (q) {
      query.$or = [
        { ticketNo: new RegExp(q, "i") },
        { subject: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { category: new RegExp(q, "i") },
        { requesterName: new RegExp(q, "i") },
        { requesterEmail: new RegExp(q, "i") },
        { status: new RegExp(q, "i") },
      ];
    }

    if (status !== "all") query.status = status;
    if (category !== "all") query.category = category;
    if (priority !== "all") query.priority = priority;

    const tickets = await HelpdeskTicket.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const data = tickets.map(serializeTicket);

    return res.render("tenant/admin/helpdesk/index", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      tickets: data,
      kpis: computeKpis(data),
      query: { q, status, category, priority },
    });
  },

  create: async (req, res) => {
    const { HelpdeskTicket } = req.models;

    const subject = str(req.body.subject);
    const description = str(req.body.description);

    if (!subject || !description) {
      req.flash?.("error", "Subject and description are required.");
      return res.redirect("/admin/helpdesk");
    }

    const count = await HelpdeskTicket.countDocuments({});
    const ticketNo = `TKT-${String(count + 1).padStart(5, "0")}`;

    await HelpdeskTicket.create({
      ticketNo,
      subject,
      description,
      category: str(req.body.category || "General"),
      requesterName: str(req.body.requesterName || ""),
      requesterEmail: str(req.body.requesterEmail || ""),
      assignedTo: str(req.body.assignedTo || ""),
      priority: str(req.body.priority || "Medium"),
      status: str(req.body.status || "Open"),
      dueDate: asDate(req.body.dueDate),
      slaHours: Number(req.body.slaHours || 0),
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    req.flash?.("success", "Ticket created successfully.");
    return res.redirect("/admin/helpdesk");
  },

  update: async (req, res) => {
    const { HelpdeskTicket } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid ticket ID.");
      return res.redirect("/admin/helpdesk");
    }

    const item = await HelpdeskTicket.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!item) {
      req.flash?.("error", "Ticket not found.");
      return res.redirect("/admin/helpdesk");
    }

    const subject = str(req.body.subject);
    const description = str(req.body.description);

    if (!subject || !description) {
      req.flash?.("error", "Subject and description are required.");
      return res.redirect("/admin/helpdesk");
    }

    item.subject = subject;
    item.description = description;
    item.category = str(req.body.category || "General");
    item.requesterName = str(req.body.requesterName || "");
    item.requesterEmail = str(req.body.requesterEmail || "");
    item.assignedTo = str(req.body.assignedTo || "");
    item.priority = str(req.body.priority || "Medium");
    item.status = str(req.body.status || "Open");
    item.dueDate = asDate(req.body.dueDate);
    item.slaHours = Number(req.body.slaHours || 0);
    item.updatedBy = actorUserId(req);

    await item.save();

    req.flash?.("success", "Ticket updated successfully.");
    return res.redirect("/admin/helpdesk");
  },

  progress: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/helpdesk");

    await HelpdeskTicket.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "In Progress", updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/helpdesk");
  },

  resolve: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/helpdesk");

    await HelpdeskTicket.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Resolved", resolvedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/helpdesk");
  },

  close: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/helpdesk");

    await HelpdeskTicket.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Closed", updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/helpdesk");
  },

  delete: async (req, res) => {
    const { HelpdeskTicket } = req.models;
    if (!isValidId(req.params.id)) return res.redirect("/admin/helpdesk");

    await HelpdeskTicket.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorUserId(req) } }
    );

    return res.redirect("/admin/helpdesk");
  },

  bulkAction: async (req, res) => {
    const { HelpdeskTicket } = req.models;

    const ids = String(req.body.ids || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    const action = str(req.body.action);
    if (!ids.length || !action) return res.redirect("/admin/helpdesk");

    const patch = { updatedBy: actorUserId(req) };

    if (action === "progress") {
      patch.status = "In Progress";
    } else if (action === "resolve") {
      patch.status = "Resolved";
      patch.resolvedAt = new Date();
    } else if (action === "close") {
      patch.status = "Closed";
    } else {
      return res.redirect("/admin/helpdesk");
    }

    await HelpdeskTicket.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    return res.redirect("/admin/helpdesk");
  },
};