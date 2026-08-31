const { transitionLetterRequest, assertDocumentSigningConfigured } = require("../../../services/tenant/studentSelfServiceService");
const actor = (req) => req.user?._id || req.tenantUser?._id || null;

module.exports = {
  list: async (req, res) => {
    try {
      const requests = await req.models.LetterRequest.find({ isDeleted: { $ne: true } })
        .populate("studentId", "firstName lastName fullName regNo studentNo classLevel academicYear term")
        .sort({ status: 1, createdAt: -1 }).limit(500).lean();
      return res.render("tenant/transcripts/letters", { tenant: req.tenant || null, requests, csrfToken: res.locals.csrfToken || "", messages: { success: req.flash ? req.flash("success") : [], error: req.flash ? req.flash("error") : [] } });
    } catch (err) { console.error("LETTER REQUEST ADMIN ERROR:", err); return res.status(500).send("Failed to load letter requests."); }
  },
  status: async (req, res) => {
    try {
      const target = String(req.body?.status || "");
      let issuedSnapshot = null;
      if (target === "Ready") {
        assertDocumentSigningConfigured();
        const current = await req.models.LetterRequest.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
        if (!current) throw new Error("Letter request not found.");
        const [openInvoice, student] = await Promise.all([
          req.models.Invoice.findOne({ studentId: current.studentId, status: { $in: ["Unpaid", "Partially Paid", "Overdue"] }, isDeleted: { $ne: true } }).select("_id").lean(),
          req.models.Student.findOne({ _id: current.studentId, isDeleted: { $ne: true } }).select("firstName lastName fullName regNo studentNo classLevel academicYear term").lean(),
        ]);
        if (openInvoice) throw new Error("This letter cannot be released while the student has an outstanding invoice.");
        if (!student) throw new Error("Student record is unavailable; the official letter cannot be released.");
        issuedSnapshot = {
          studentName: student.fullName || [student.firstName, student.lastName].filter(Boolean).join(" ") || "Student",
          registrationNumber: student.regNo || student.studentNo || "",
          classLevel: student.classLevel || "", academicYear: current.academicYear, term: current.term, purpose: current.purpose || "",
        };
      }
      await transitionLetterRequest(req.models.LetterRequest, { id: req.params.id, revision: req.body?.revision, status: target, actorUserId: actor(req), note: req.body?.note, issuedSnapshot });
      req.flash?.("success", "Letter request status updated.");
    } catch (err) { req.flash?.("error", err.message || "Could not update letter request."); }
    return res.redirect("/admin/transcripts/letters");
  },
};
