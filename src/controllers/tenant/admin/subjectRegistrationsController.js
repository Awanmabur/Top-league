const mongoose = require("mongoose");
const { decideSubjectRegistration, str, cleanTerm } = require("../../../services/tenant/studentSelfServiceService");

const oid = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const actor = (req) => req.user?._id || req.tenantUser?._id || null;
const back = (res) => res.redirect("/admin/subjects/registrations");

module.exports = {
  list: async (req, res) => {
    try {
      const { CourseRegistration, RegistrationWindow, StudentHold, Student, Class } = req.models;
      const [windows, registrations, holds, students, classes] = await Promise.all([
        RegistrationWindow.find({ isDeleted: { $ne: true } }).sort({ academicYear: -1, term: -1, opensAt: -1 }).limit(100).lean(),
        CourseRegistration.find({ isDeleted: { $ne: true } }).populate("studentId", "firstName lastName fullName regNo studentNo classLevel academicYear term").populate("subjectId", "code title").sort({ status: 1, createdAt: -1 }).limit(300).lean(),
        StudentHold.find({ status: "active", isDeleted: { $ne: true } }).populate("studentId", "firstName lastName fullName regNo studentNo classLevel").sort({ createdAt: -1 }).limit(100).lean(),
        Student.find({ status: { $in: ["active", "on_hold"] }, isDeleted: { $ne: true } }).select("firstName lastName fullName regNo studentNo classLevel").sort({ firstName: 1, lastName: 1 }).limit(1000).lean(),
        Class.find({ isDeleted: { $ne: true } }).select("name code classLevel stream academicYear term").sort({ classLevel: 1, name: 1 }).limit(500).lean(),
      ]);
      return res.render("tenant/subjects/registrations", {
        tenant: req.tenant || null, windows, registrations, holds, students, classes,
        csrfToken: res.locals.csrfToken || "",
        messages: { success: req.flash ? req.flash("success") : [], error: req.flash ? req.flash("error") : [] },
      });
    } catch (err) { console.error("SUBJECT REGISTRATIONS ADMIN ERROR:", err); return res.status(500).send("Failed to load subject registrations."); }
  },

  createWindow: async (req, res) => {
    try {
      const opensAt = new Date(req.body?.opensAt); const closesAt = new Date(req.body?.closesAt);
      const term = cleanTerm(req.body?.term); const academicYear = str(req.body?.academicYear, 20);
      const status = ["draft", "open", "closed"].includes(req.body?.status) ? req.body.status : "draft";
      if (!academicYear || !term || Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime()) || closesAt <= opensAt) throw new Error("Valid academic year, term, opening time and later closing time are required.");
      await req.models.RegistrationWindow.create({
        name: str(req.body?.name || `Subject Registration ${academicYear} T${term}`, 160), academicYear, term,
        classId: str(req.body?.classId, 80), classLevel: str(req.body?.classLevel, 20).toUpperCase(), sectionId: str(req.body?.sectionId, 80), streamId: str(req.body?.streamId, 80),
        opensAt, closesAt, status, maxOptionalSubjects: Math.max(0, Math.min(30, Number(req.body?.maxOptionalSubjects ?? 4) || 0)), allowDrop: req.body?.allowDrop === "on" || req.body?.allowDrop === "true" || req.body?.allowDrop === "1", createdBy: actor(req), updatedBy: actor(req),
      });
      req.flash?.("success", "Registration window created.");
    } catch (err) { req.flash?.("error", err.message || "Could not create registration window."); }
    return back(res);
  },

  updateWindow: async (req, res) => {
    try {
      if (!oid(req.params.id)) throw new Error("Registration window not found.");
      const expected = Number(req.body?.revision); if (!Number.isInteger(expected) || expected < 1) throw new Error("Registration window revision is required.");
      const current = await req.models.RegistrationWindow.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!current) throw new Error("Registration window not found.");
      const status = ["draft", "open", "closed"].includes(req.body?.status) ? req.body.status : current.status;
      const write = await req.models.RegistrationWindow.findOneAndUpdate({ _id: current._id, revision: expected, isDeleted: { $ne: true } }, { $set: { status, allowDrop: req.body?.allowDrop === "on" || req.body?.allowDrop === "true" || req.body?.allowDrop === "1", maxOptionalSubjects: Math.max(0, Math.min(30, Number(req.body?.maxOptionalSubjects ?? current.maxOptionalSubjects) || 0)), updatedBy: actor(req) }, $inc: { revision: 1 } }, { new: true });
      if (!write) throw new Error("Registration window changed in another session. Reload and try again.");
      req.flash?.("success", "Registration window updated.");
    } catch (err) { req.flash?.("error", err.message || "Could not update registration window."); }
    return back(res);
  },

  decide: async (req, res) => {
    try {
      await decideSubjectRegistration(req.models.CourseRegistration, { id: req.params.id, revision: req.body?.revision, status: req.body?.status, actorUserId: actor(req), note: req.body?.note });
      req.flash?.("success", "Subject registration decision saved.");
    } catch (err) { req.flash?.("error", err.message || "Could not update subject registration."); }
    return back(res);
  },

  createHold: async (req, res) => {
    try {
      if (!oid(req.body?.studentId)) throw new Error("Valid student is required.");
      const reason = str(req.body?.reason, 500); if (!reason) throw new Error("Hold reason is required.");
      const type = ["academic", "finance", "discipline", "documents", "other"].includes(req.body?.type) ? req.body.type : "other";
      const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("Invalid hold expiry.");
      await req.models.StudentHold.create({ studentId: req.body.studentId, type, reason, blocksSubjectRegistration: true, expiresAt, createdBy: actor(req), updatedBy: actor(req) });
      req.flash?.("success", "Student registration hold created.");
    } catch (err) { req.flash?.("error", err.message || "Could not create hold."); }
    return back(res);
  },

  clearHold: async (req, res) => {
    try {
      if (!oid(req.params.id)) throw new Error("Hold not found.");
      const expected = Number(req.body?.revision); if (!Number.isInteger(expected) || expected < 1) throw new Error("Hold revision is required.");
      const write = await req.models.StudentHold.findOneAndUpdate({ _id: req.params.id, revision: expected, status: "active", isDeleted: { $ne: true } }, { $set: { status: "cleared", clearedAt: new Date(), clearedBy: actor(req), updatedBy: actor(req) }, $inc: { revision: 1 } }, { new: true });
      if (!write) throw new Error("Hold changed in another session or is already cleared.");
      req.flash?.("success", "Student registration hold cleared.");
    } catch (err) { req.flash?.("error", err.message || "Could not clear hold."); }
    return back(res);
  },
};
