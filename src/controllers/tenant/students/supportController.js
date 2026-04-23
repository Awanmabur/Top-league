const {
  getStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");

module.exports = {
  support: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { SupportTicket, Ticket } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const meta = academicMeta(student);
      const Model = SupportTicket || Ticket;

      const tickets = Model
        ? await Model.find({
            $or: [
              { studentId: student?._id || null },
              { userId: user._id },
              { email: user.email || null },
            ],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const mapped = tickets.map((t) => ({
        id: t.ticketNo || t.reference || `TKT-${String(t._id).slice(-6).toUpperCase()}`,
        dbId: String(t._id),
        status: String(t.status || "open").toLowerCase(),
        category: String(t.category || "other").toLowerCase(),
        title: t.subject || t.title || "Support request",
        created: t.createdAt || null,
        updated: t.updatedAt || t.createdAt || null,
        priority: t.priority || "Medium",
        description: t.description || t.message || "",
        thread: Array.isArray(t.thread)
          ? t.thread.map((m) => ({
              from: m.from || m.author || "Support",
              time: m.time || m.createdAt || "",
              body: m.body || m.message || "",
            }))
          : [],
      }));

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
      return res.status(500).send("Failed to load support: " + err.message);
    }
  },
};