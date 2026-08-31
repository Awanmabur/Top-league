const { getParent, canAccessChild, isValidId, loadLinkedChildren } = require("./_helpers");
const {
  createTicket,
  addThreadMessage,
  requesterDisplayName,
} = require("../../../services/tenant/helpdeskService");

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function prioritySlug(v) {
  const p = String(v || "Medium").toLowerCase();
  return p === "medium" ? "normal" : p;
}

function normalizeTicket(row = {}, children = []) {
  const linkedStudentId = row.relatedStudentId || null;
  const linkedStudent = linkedStudentId
    ? children.find((c) => String(c._id) === String(linkedStudentId))
    : null;

  return {
    ...row,
    subject: row.subject || "Support Request",
    message: row.description || "",
    category: String(row.category || "General").toLowerCase(),
    priority: prioritySlug(row.priority),
    status: String(row.status || "Open").toLowerCase().replace(/\s+/g, "_"),
    createdLabel: fmtDate(row.createdAt),
    updatedLabel: fmtDate(row.updatedAt || row.createdAt),
    studentId: linkedStudentId ? String(linkedStudentId) : "",
    studentName: linkedStudent
      ? (linkedStudent.fullName || [linkedStudent.firstName, linkedStudent.middleName, linkedStudent.lastName].filter(Boolean).join(" ").trim() || linkedStudent.regNo || "Student")
      : "General / Not linked",
    canReply: row.status !== "Closed",
    thread: Array.isArray(row.thread) ? row.thread.map((m) => ({
      author: m.author || (m.role === "Staff" ? "Support" : "Requester"),
      role: m.role || "Requester",
      body: m.body || "",
      createdLabel: fmtDate(m.createdAt),
    })) : [],
  };
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, HelpdeskTicket } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const children = await loadLinkedChildren(req, parent);
      const selectedStudentId = req.query?.student ? String(req.query.student) : "";
      const selectedStudent = selectedStudentId && canAccessChild(parent, selectedStudentId)
        ? children.find((c) => String(c._id) === selectedStudentId) || null
        : null;

      const rawTickets = await HelpdeskTicket.find({
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(100)
        .lean();

      const tickets = rawTickets.map((row) => normalizeTicket(row, children));
      const stats = {
        total: tickets.length,
        open: tickets.filter((t) => t.status === "open").length,
        pending: tickets.filter((t) => t.status === "in_progress").length,
        resolved: tickets.filter((t) => ["resolved", "closed"].includes(t.status)).length,
      };

      return res.render("parents/support", {
        tenant: req.tenant,
        user,
        parent,
        children,
        selectedStudent,
        tickets,
        stats,
        formData: {
          subject: "",
          category: selectedStudent ? "student_issue" : "general",
          priority: "normal",
          message: "",
          studentId: selectedStudent ? String(selectedStudent._id) : "",
        },
        success: req.flash?.("success") || [],
        error: req.flash?.("error") || [],
      });
    } catch (err) {
      console.error("PARENT SUPPORT INDEX ERROR:", err);
      return res.status(500).send("Failed to load support page");
    }
  },

  async store(req, res) {
    try {
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const studentId = String(req.body?.studentId || "").trim();
      if (studentId && (!isValidId(studentId) || !canAccessChild(parent, studentId))) {
        req.flash?.("error", "You can only link a support ticket to your own child.");
        return res.redirect("/parent/support");
      }

      await createTicket(req.models, {
        subject: req.body.subject,
        description: req.body.message,
        category: req.body.category,
        priority: req.body.priority,
        requesterUserId: user._id,
        requesterType: "Parent",
        relatedStudentId: studentId || null,
        requesterName: requesterDisplayName(user, parent, "Parent"),
        requesterEmail: user.email || parent?.email || "",
        actorUserId: user._id,
        authorName: requesterDisplayName(user, parent, "Parent"),
      });

      req.flash?.("success", "Support ticket submitted successfully.");
      return res.redirect("/parent/support");
    } catch (err) {
      console.error("PARENT SUPPORT STORE ERROR:", err);
      req.flash?.("error", err?.message || "Failed to submit support ticket.");
      return res.redirect("/parent/support");
    }
  },

  async reply(req, res) {
    try {
      const { HelpdeskTicket } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");
      if (!HelpdeskTicket || !isValidId(req.params.id)) return res.status(404).send("Not found");

      const ticket = await HelpdeskTicket.findOne({
        _id: req.params.id,
        requesterUserId: user._id,
        isDeleted: { $ne: true },
      });
      if (!ticket) return res.status(404).send("Not found");

      await addThreadMessage(req.models, ticket, {
        role: "Requester",
        authorUserId: user._id,
        authorName: requesterDisplayName(user, parent, "Parent"),
        body: req.body.message,
      });
      req.flash?.("success", "Reply sent successfully.");
      return res.redirect("/parent/support");
    } catch (err) {
      console.error("PARENT SUPPORT REPLY ERROR:", err);
      req.flash?.("error", err?.message || "Failed to send reply.");
      return res.redirect("/parent/support");
    }
  },
};
