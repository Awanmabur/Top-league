const { getParent, canAccessChild } = require("./_helpers");

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function normalizeTicket(row = {}, children = []) {
  const linkedStudentId = row.student || row.studentId || null;
  const linkedStudent =
    linkedStudentId
      ? children.find((c) => String(c._id) === String(linkedStudentId))
      : null;

  return {
    ...row,
    subject: row.subject || row.title || "Support Request",
    message: row.message || row.body || row.description || "",
    category: row.category || row.type || "general",
    priority: String(row.priority || "normal").toLowerCase(),
    status: String(row.status || "open").toLowerCase(),
    createdLabel: fmtDate(row.createdAt),
    updatedLabel: fmtDate(row.updatedAt || row.createdAt),
    studentId: linkedStudentId ? String(linkedStudentId) : "",
    studentName: linkedStudent
      ? (linkedStudent.fullName ||
          [linkedStudent.firstName, linkedStudent.middleName, linkedStudent.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          linkedStudent.regNo ||
          "Student")
      : (row.studentName || "General / Not linked"),
  };
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, SupportTicket, Ticket } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select("firstName lastName middleName fullName regNo classGroup program")
              .populate({ path: "classGroup", select: "code name title" })
              .populate({ path: "program", select: "code name title" })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      const selectedStudentId = req.query?.student ? String(req.query.student) : "";
      const selectedStudent =
        selectedStudentId && canAccessChild(parent, selectedStudentId)
          ? children.find((c) => String(c._id) === selectedStudentId) || null
          : null;

      const ticketModel = SupportTicket || Ticket || null;

      const rawTickets = ticketModel
        ? await ticketModel
            .find({
              deletedAt: null,
              $or: [
                { userId: user._id },
                { user: user._id },
                { email: user.email },
                { parentId: parent?._id || null },
              ],
            })
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(100)
            .lean()
            .catch(() => [])
        : [];

      const tickets = rawTickets.map((row) => normalizeTicket(row, children));

      const stats = {
        total: tickets.length,
        open: tickets.filter((t) => ["open", "new"].includes(t.status)).length,
        pending: tickets.filter((t) => ["pending", "in_progress"].includes(t.status)).length,
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
      const { SupportTicket, Ticket } = req.models || {};
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const ticketModel = SupportTicket || Ticket || null;
      if (!ticketModel) {
        req.flash?.("error", "Support module is not available.");
        return res.redirect("/parent/support");
      }

      const subject = String(req.body?.subject || "").trim();
      const category = String(req.body?.category || "general").trim();
      const priority = String(req.body?.priority || "normal").trim().toLowerCase();
      const message = String(req.body?.message || "").trim();
      const studentId = String(req.body?.studentId || "").trim();

      if (!subject || !message) {
        req.flash?.("error", "Subject and message are required.");
        return res.redirect("/parent/support");
      }

      let linkedStudentId = null;
      if (studentId && canAccessChild(parent, studentId)) {
        linkedStudentId = studentId;
      }

      const payload = {
        subject,
        title: subject,
        category,
        priority,
        message,
        body: message,
        status: "open",
        userId: user._id,
        user: user._id,
        email: user.email,
        parentId: parent?._id || null,
        studentId: linkedStudentId || null,
        student: linkedStudentId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await ticketModel.create(payload);

      req.flash?.("success", "Support ticket submitted successfully.");
      return res.redirect("/parent/support");
    } catch (err) {
      console.error("PARENT SUPPORT STORE ERROR:", err);
      req.flash?.("error", err?.message || "Failed to submit support ticket.");
      return res.redirect("/parent/support");
    }
  },
};
