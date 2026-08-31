const mongoose = require("mongoose");
const { str, safeExternalUrl, transitionJob, transitionJobApplication } = require("../../../services/tenant/studentSelfServiceService");
const oid = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const actor = (req) => req.user?._id || req.tenantUser?._id || null;
const TYPES = ["Internship", "Part-time", "Full-time", "Contract", "Graduate Program", "Opportunity"];

function payload(body = {}) {
  const externalRaw = str(body.externalApplyUrl, 1000);
  const externalApplyUrl = safeExternalUrl(externalRaw);
  if (externalRaw && !externalApplyUrl) throw new Error("External application URL must be a valid http/https URL.");
  const deadline = body.deadline ? new Date(body.deadline) : null;
  const publishAt = body.publishAt ? new Date(body.publishAt) : null;
  if (deadline && Number.isNaN(deadline.getTime())) throw new Error("Invalid application deadline.");
  if (publishAt && Number.isNaN(publishAt.getTime())) throw new Error("Invalid publication time.");
  if (deadline && publishAt && deadline <= publishAt) throw new Error("Application deadline must be after publication time.");
  const eligibleClassLevels = String(body.eligibleClassLevels || "").split(",").map((x) => str(x, 20).toUpperCase()).filter(Boolean).slice(0, 30);
  const title = str(body.title, 180), employer = str(body.employer, 180), description = str(body.description, 5000);
  if (!title || !employer || !description) throw new Error("Title, employer and description are required.");
  return { title, employer, description, requirements: str(body.requirements, 3000), type: TYPES.includes(body.type) ? body.type : "Opportunity", location: str(body.location, 180), externalApplyUrl, publishAt, deadline, eligibleClassLevels };
}

module.exports = {
  list: async (req, res) => {
    try {
      const { JobOpportunity, JobApplication } = req.models;
      const [jobs, applications] = await Promise.all([
        JobOpportunity.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(300).lean(),
        JobApplication.find({ isDeleted: { $ne: true } }).populate("jobId", "title employer").populate("studentId", "firstName lastName fullName regNo studentNo classLevel").sort({ createdAt: -1 }).limit(500).lean(),
      ]);
      return res.render("tenant/jobs/index", { tenant: req.tenant || null, jobs, applications, types: TYPES, csrfToken: res.locals.csrfToken || "", messages: { success: req.flash ? req.flash("success") : [], error: req.flash ? req.flash("error") : [] } });
    } catch (err) { console.error("ADMIN JOBS ERROR:", err); return res.status(500).send("Failed to load jobs."); }
  },
  create: async (req, res) => {
    try { await req.models.JobOpportunity.create({ ...payload(req.body), status: "Draft", createdBy: actor(req), updatedBy: actor(req) }); req.flash?.("success", "Opportunity created as Draft."); }
    catch (err) { req.flash?.("error", err.message || "Could not create opportunity."); }
    return res.redirect("/admin/jobs");
  },
  update: async (req, res) => {
    try {
      if (!oid(req.params.id)) throw new Error("Opportunity not found.");
      const current = await req.models.JobOpportunity.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
      if (!current) throw new Error("Opportunity not found.");
      if (!['Draft','Closed'].includes(current.status)) throw new Error("Close a published opportunity before editing its content.");
      const revision = Number(req.body?.revision); if (!Number.isInteger(revision) || revision !== Number(current.revision || 1)) throw new Error("Opportunity changed in another session. Reload and try again.");
      const write = await req.models.JobOpportunity.findOneAndUpdate({ _id: current._id, revision, status: current.status, isDeleted: { $ne: true } }, { $set: { ...payload(req.body), updatedBy: actor(req) }, $inc: { revision: 1 } }, { new: true });
      if (!write) throw new Error("Opportunity changed in another session. Reload and try again.");
      req.flash?.("success", "Opportunity updated.");
    } catch (err) { req.flash?.("error", err.message || "Could not update opportunity."); }
    return res.redirect("/admin/jobs");
  },
  status: async (req, res) => {
    try { await transitionJob(req.models.JobOpportunity, { id: req.params.id, revision: req.body?.revision, status: req.body?.status, actorUserId: actor(req) }); req.flash?.("success", "Opportunity status updated."); }
    catch (err) { req.flash?.("error", err.message || "Could not update opportunity status."); }
    return res.redirect("/admin/jobs");
  },
  applicationStatus: async (req, res) => {
    try { await transitionJobApplication(req.models.JobApplication, { id: req.params.id, revision: req.body?.revision, status: req.body?.status, actorUserId: actor(req), note: req.body?.note }); req.flash?.("success", "Application status updated."); }
    catch (err) { req.flash?.("error", err.message || "Could not update application."); }
    return res.redirect("/admin/jobs");
  },
  _test: { payload },
};
