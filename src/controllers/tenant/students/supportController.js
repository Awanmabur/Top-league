const {
  getStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  isObjId,
} = require("./_helpers");
const {
  createTicket,
  addThreadMessage,
  requesterDisplayName,
} = require("../../../services/tenant/helpdeskService");

function statusSlug(status) {
  const clean = String(status || "Open").trim().toLowerCase();
  return clean.replace(/\s+/g, "-");
}

function categorySlug(category) {
  const clean = String(category || "General");
  if (clean === "Finance") return "finance";
  if (["Academic", "Attendance", "Admissions"].includes(clean)) return "registration";
  if (clean === "Hostel") return "hostel";
  if (clean === "Technical") return "it";
  return "other";
}

function mapTicket(t) {
  return {
    id: t.ticketNo || `TKT-${String(t._id).slice(-6).toUpperCase()}`,
    dbId: String(t._id),
    status: statusSlug(t.status),
    category: categorySlug(t.category),
    title: t.subject || "Support request",
    created: t.createdAt || null,
    updated: t.updatedAt || t.createdAt || null,
    priority: t.priority || "Medium",
    description: t.description || "",
    canReply: t.status !== "Closed",
    thread: Array.isArray(t.thread)
      ? t.thread.map((m) => ({
          from: m.author || (m.role === "Staff" ? "Support" : "Requester"),
          role: m.role || "Requester",
          time: m.createdAt || "",
          body: m.body || "",
        }))
      : [],
  };
}

module.exports = {
  support: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");
      const { HelpdeskTicket } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");

      const meta = academicMeta(student);
      const tickets = await HelpdeskTicket.find({
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(100)
        .lean();

      const mapped = tickets.map(mapTicket);
      const stats = {
        total: mapped.length,
        open: mapped.filter((t) => t.status === "open").length,
        inProgress: mapped.filter((t) => t.status === "in-progress").length,
        closed: mapped.filter((t) => ["resolved", "closed"].includes(t.status)).length,
      };

      return renderView(req, res, "students/support", {
        pageTitle: "Support Tickets",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        tickets: mapped,
        stats,
      });
    } catch (err) {
      console.error("STUDENT SUPPORT INDEX ERROR:", err);
      console.error("Student support error:", err);
      return res.status(500).send("Failed to load support.");
    }
  },

  create: async (req, res) => {
    try {
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");

      await createTicket(req.models, {
        subject: req.body.subject,
        description: req.body.description,
        category: req.body.category,
        priority: req.body.priority,
        requesterUserId: user._id,
        requesterType: "Student",
        relatedStudentId: student?._id || null,
        requesterName: requesterDisplayName(user, student, "Student"),
        requesterEmail: user.email || student?.email || "",
        actorUserId: user._id,
        authorName: requesterDisplayName(user, student, "Student"),
      });

      req.flash?.("success", "Support ticket submitted successfully.");
      return res.redirect("/student/support");
    } catch (err) {
      console.error("STUDENT SUPPORT CREATE ERROR:", err);
      req.flash?.("error", err?.message || "Failed to submit support ticket.");
      return res.redirect("/student/support");
    }
  },

  reply: async (req, res) => {
    try {
      const { HelpdeskTicket } = req.models || {};
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");
      if (!HelpdeskTicket || !isObjId(req.params.id)) return res.status(404).send("Not found");

      const ticket = await HelpdeskTicket.findOne({
        _id: req.params.id,
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      });
      if (!ticket) return res.status(404).send("Not found");

      await addThreadMessage(req.models, ticket, {
        role: "Requester",
        authorUserId: user._id,
        authorName: requesterDisplayName(user, student, "Student"),
        body: req.body.message,
      });
      req.flash?.("success", "Reply sent successfully.");
      return res.redirect("/student/support");
    } catch (err) {
      console.error("STUDENT SUPPORT REPLY ERROR:", err);
      req.flash?.("error", err?.message || "Failed to send reply.");
      return res.redirect("/student/support");
    }
  },
};
