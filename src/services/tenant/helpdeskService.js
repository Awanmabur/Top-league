const crypto = require("crypto");

const CATEGORY_MAP = new Map([
  ["general", "General"],
  ["other", "General"],
  ["technical", "Technical"],
  ["it", "Technical"],
  ["it & portal", "Technical"],
  ["finance", "Finance"],
  ["fees", "Finance"],
  ["finance & fees", "Finance"],
  ["admissions", "Admissions"],
  ["library", "Library"],
  ["hostel", "Hostel"],
  ["registration", "Academic"],
  ["student_issue", "Academic"],
  ["results", "Academic"],
  ["academic", "Academic"],
  ["attendance", "Attendance"],
]);

const PRIORITY_MAP = new Map([
  ["low", "Low"],
  ["normal", "Medium"],
  ["medium", "Medium"],
  ["high", "High"],
  ["urgent", "Urgent"],
]);

const REQUESTER_TYPES = new Set(["Student", "Parent", "Staff", "Admin", "External"]);
const STATUSES = new Set(["Open", "In Progress", "Resolved", "Closed"]);

const str = (v) => String(v ?? "").trim();

function normalizeCategory(value) {
  return CATEGORY_MAP.get(str(value).toLowerCase()) || "General";
}

function normalizePriority(value) {
  return PRIORITY_MAP.get(str(value).toLowerCase()) || "Medium";
}

function normalizeRequesterType(value) {
  const clean = str(value);
  return REQUESTER_TYPES.has(clean) ? clean : "External";
}

function normalizeStatus(value) {
  const clean = str(value);
  return STATUSES.has(clean) ? clean : "Open";
}

function formatDuration(from, to) {
  const a = from ? new Date(from).getTime() : NaN;
  const b = to ? new Date(to).getTime() : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const mins = Math.max(0, Math.round((b - a) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function ticketNoCandidate(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `TKT-${day}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function generateTicketNo(HelpdeskTicket) {
  for (let i = 0; i < 10; i += 1) {
    const ticketNo = ticketNoCandidate();
    const exists = await HelpdeskTicket.exists({ ticketNo });
    if (!exists) return ticketNo;
  }
  throw new Error("Unable to allocate a unique support ticket number.");
}

function requesterDisplayName(user, profile, fallback = "") {
  return str(
    profile?.fullName ||
      [profile?.firstName, profile?.middleName, profile?.lastName].filter(Boolean).join(" ") ||
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      fallback
  );
}

function portalUrl(ticket) {
  switch (ticket.requesterType) {
    case "Student": return "/student/support";
    case "Parent": return "/parent/support";
    case "Staff": return `/staff/support/${ticket._id}`;
    case "Admin": return "/admin/helpdesk";
    default: return "/admin/helpdesk";
  }
}

function notificationAudience(requesterType) {
  if (requesterType === "Student") return "student";
  if (requesterType === "Staff") return "staff";
  if (requesterType === "Admin") return "admin";
  return "all";
}

async function notifyRequester(models, ticket, message) {
  const Notification = models?.Notification;
  if (!Notification || !ticket?.requesterUserId) return;
  await Notification.create({
    audience: notificationAudience(ticket.requesterType),
    userId: ticket.requesterUserId,
    title: `Support reply • ${ticket.ticketNo}`,
    message: str(message).slice(0, 2000) || "Your support ticket has a new reply.",
    type: "info",
    url: portalUrl(ticket),
    entityType: "HelpdeskTicket",
    entityId: ticket._id,
    createdBy: ticket.updatedBy || null,
  }).catch(() => null);
}

async function notifyAdmins(models, ticket, message, actorUserId = null) {
  const Notification = models?.Notification;
  if (!Notification) return;
  await Notification.create({
    audience: "admin",
    userId: null,
    title: `Helpdesk update • ${ticket.ticketNo}`,
    message: str(message).slice(0, 2000) || `${ticket.requesterType} updated a support ticket.`,
    type: ticket.priority === "Urgent" ? "warning" : "info",
    url: "/admin/helpdesk",
    entityType: "HelpdeskTicket",
    entityId: ticket._id,
    createdBy: actorUserId || null,
  }).catch(() => null);
}

function refreshStats(ticket) {
  const thread = Array.isArray(ticket.thread) ? ticket.thread : [];
  ticket.stats = ticket.stats || {};
  ticket.stats.replies = Math.max(0, thread.length - 1);
  ticket.stats.firstResponse = ticket.firstResponseAt
    ? formatDuration(ticket.createdAt, ticket.firstResponseAt)
    : "—";
  ticket.stats.resolutionTime = ticket.resolvedAt
    ? formatDuration(ticket.createdAt, ticket.resolvedAt)
    : "—";
  if (ticket.dueDate && !["Resolved", "Closed"].includes(ticket.status)) {
    ticket.stats.slaBreached = new Date(ticket.dueDate).getTime() < Date.now();
  } else {
    ticket.stats.slaBreached = false;
  }
}

async function createTicket(models, input = {}) {
  const HelpdeskTicket = models?.HelpdeskTicket;
  if (!HelpdeskTicket) throw new Error("HelpdeskTicket model is unavailable.");

  const subject = str(input.subject);
  const description = str(input.description || input.message);
  if (!subject || !description) throw new Error("Subject and description are required.");

  const now = new Date();
  const requesterType = normalizeRequesterType(input.requesterType);
  const actorUserId = input.actorUserId || input.requesterUserId || null;
  const slaHours = Math.max(0, Number(input.slaHours || 0) || 0);
  const dueDate = input.dueDate ? new Date(input.dueDate) : (slaHours ? new Date(now.getTime() + slaHours * 3600000) : null);

  const ticket = await HelpdeskTicket.create({
    ticketNo: await generateTicketNo(HelpdeskTicket),
    subject,
    description,
    category: normalizeCategory(input.category),
    requesterUserId: input.requesterUserId || null,
    requesterType,
    relatedStudentId: input.relatedStudentId || null,
    requesterName: str(input.requesterName),
    requesterEmail: str(input.requesterEmail).toLowerCase(),
    assignedToUserId: input.assignedToUserId || null,
    assignedTo: str(input.assignedTo),
    priority: normalizePriority(input.priority),
    status: normalizeStatus(input.status),
    dueDate: Number.isNaN(dueDate?.getTime?.()) ? null : dueDate,
    slaHours,
    requesterLastReplyAt: requesterType === "External" && !input.requesterUserId ? null : now,
    thread: [{
      authorUserId: input.requesterUserId || actorUserId || null,
      author: str(input.authorName || input.requesterName || requesterType),
      role: requesterType === "Admin" && input.adminCreated ? "Staff" : "Requester",
      body: description,
      createdAt: now,
    }],
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });

  if (ticket.status !== "Open") applyStatus(ticket, ticket.status);
  else refreshStats(ticket);
  await ticket.save();
  if (["Student", "Parent", "Staff"].includes(requesterType)) {
    await notifyAdmins(models, ticket, `${requesterType} opened: ${subject}`, actorUserId);
  }
  return ticket;
}

async function addThreadMessage(models, ticket, input = {}) {
  if (!ticket) throw new Error("Ticket not found.");
  if (ticket.status === "Closed") throw new Error("Closed tickets cannot accept new replies.");

  const body = str(input.body || input.message);
  if (!body) throw new Error("Reply message is required.");

  const now = new Date();
  const role = input.role === "Staff" ? "Staff" : input.role === "System" ? "System" : "Requester";
  ticket.thread.push({
    authorUserId: input.authorUserId || null,
    author: str(input.authorName || (role === "Staff" ? "Support" : "Requester")),
    role,
    body,
    createdAt: now,
  });
  ticket.updatedBy = input.authorUserId || ticket.updatedBy || null;

  if (role === "Staff") {
    ticket.staffLastReplyAt = now;
    if (!ticket.firstResponseAt) ticket.firstResponseAt = now;
    if (ticket.status === "Open") ticket.status = "In Progress";
  } else if (role === "Requester") {
    ticket.requesterLastReplyAt = now;
    if (ticket.status === "Resolved") {
      ticket.status = "In Progress";
      ticket.resolvedAt = null;
    }
  }

  refreshStats(ticket);
  await ticket.save();

  if (role === "Staff") await notifyRequester(models, ticket, body);
  if (role === "Requester") await notifyAdmins(models, ticket, body, input.authorUserId || null);
  return ticket;
}

function applyStatus(ticket, status) {
  const next = normalizeStatus(status);
  if (ticket.status === "Closed" && next !== "Closed") {
    throw new Error("Closed tickets are terminal.");
  }
  const now = new Date();
  ticket.status = next;
  if (next === "Resolved") {
    ticket.resolvedAt = ticket.resolvedAt || now;
    ticket.closedAt = null;
  } else if (next === "Closed") {
    ticket.closedAt = ticket.closedAt || now;
    ticket.resolvedAt = ticket.resolvedAt || now;
  } else {
    ticket.resolvedAt = null;
    ticket.closedAt = null;
  }
  refreshStats(ticket);
  return ticket;
}

module.exports = {
  normalizeCategory,
  normalizePriority,
  normalizeRequesterType,
  normalizeStatus,
  formatDuration,
  ticketNoCandidate,
  generateTicketNo,
  requesterDisplayName,
  refreshStats,
  createTicket,
  addThreadMessage,
  applyStatus,
  notifyRequester,
  notifyAdmins,
};
