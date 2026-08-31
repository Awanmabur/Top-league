const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");
const {
  jobVisibleToStudent,
  createJobApplication,
  withdrawJobApplication,
} = require("../../../services/tenant/studentSelfServiceService");

async function loadPage(req, res) {
  if (!req.models) return res.status(500).send("Tenant models not loaded");
  const { JobOpportunity, JobApplication } = req.models;
  const got = await getStudent(req);
  const user = got?.user || null;
  const student = got?.student || null;
  if (!user) return res.redirect("/login");
  const blocked = mustHaveStudent(res, {
    tenant: req.tenant,
    user,
    student,
    currentPath: req.originalUrl,
    pageTitle: "Jobs & Opportunities",
  }, "students/jobs");
  if (blocked) return blocked;

  const now = new Date();
  const rawJobs = await JobOpportunity.find({
    status: "Published",
    isDeleted: { $ne: true },
    $and: [
      { $or: [{ publishAt: null }, { publishAt: { $exists: false } }, { publishAt: { $lte: now } }] },
      { $or: [{ deadline: null }, { deadline: { $exists: false } }, { deadline: { $gte: now } }] },
    ],
  }).sort({ deadline: 1, createdAt: -1 }).limit(100).lean();
  const visibleJobs = rawJobs.filter((job) => jobVisibleToStudent(job, student, now));
  const applications = await JobApplication.find({ studentId: student._id, isDeleted: { $ne: true } })
    .sort({ createdAt: -1 }).lean();
  const byJob = new Map(applications.map((app) => [String(app.jobId), app]));

  const jobs = visibleJobs.map((job) => {
    const application = byJob.get(String(job._id)) || null;
    return {
      id: String(job._id),
      title: job.title,
      company: job.employer,
      type: job.type,
      location: job.location || "Not specified",
      summary: job.description,
      requirements: job.requirements || "",
      deadline: job.deadline || null,
      externalApplyUrl: job.externalApplyUrl || "",
      application: application ? {
        id: String(application._id),
        status: application.status,
        submittedAt: application.submittedAt || application.createdAt,
        canWithdraw: ["Submitted", "Reviewing", "Shortlisted"].includes(application.status),
      } : null,
    };
  });

  return renderView(req, res, "students/jobs", {
    pageTitle: "Jobs & Opportunities",
    user,
    student,
    studentName: getStudentDisplayName(student, user),
    meta: academicMeta(student),
    jobs,
    applications,
    stats: {
      total: jobs.length,
      internships: jobs.filter((j) => j.type === "Internship").length,
      partTime: jobs.filter((j) => j.type === "Part-time").length,
      applied: applications.filter((a) => a.status !== "Withdrawn").length,
    },
  });
}

module.exports = {
  jobs: async (req, res) => {
    try { return await loadPage(req, res); }
    catch (err) { console.error("STUDENT JOBS ERROR:", err); return res.status(500).send("Failed to load jobs."); }
  },

  apply: async (req, res) => {
    try {
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student) return res.status(403).send("Student profile required.");
      await createJobApplication(req.models, {
        student: got.student,
        userId: got.user._id,
        jobId: req.params.jobId,
        coverNote: req.body?.coverNote,
      });
      req.flash?.("success", "Application submitted.");
    } catch (err) {
      req.flash?.("error", err.message || "Could not submit application.");
    }
    return res.redirect("/student/jobs");
  },

  withdraw: async (req, res) => {
    try {
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student) return res.status(403).send("Student profile required.");
      await withdrawJobApplication(req.models?.JobApplication, {
        student: got.student,
        applicationId: req.params.applicationId,
        userId: got.user._id,
      });
      req.flash?.("success", "Application withdrawn.");
    } catch (err) {
      req.flash?.("error", err.message || "Could not withdraw application.");
    }
    return res.redirect("/student/jobs");
  },

  _test: { loadPage },
};
