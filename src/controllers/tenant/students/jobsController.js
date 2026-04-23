const {
  getStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");

module.exports = {
  jobs: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Job, Opportunity, Application } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const meta = academicMeta(student);

      const sourceModel = Job || Opportunity;

      const jobs = sourceModel
        ? await sourceModel.find({
            status: { $in: ["open", "published", "active"] },
          })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean()
            .catch(() => [])
        : [];

      const applications = Application
        ? await Application.find({
            $or: [{ studentId: student?._id || null }, { userId: user._id }],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      return renderView(req, res, "students/jobs", {
        pageTitle: "Jobs & Opportunities",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        jobs: jobs.map((j) => ({
          id: String(j._id),
          title: j.title || j.name || "Opportunity",
          employer: j.company || j.organisation || j.organization || "Employer",
          type: j.type || j.jobType || "Opportunity",
          location: j.location || "Not specified",
          deadline: j.deadline || j.closingDate || null,
          description: j.description || "",
        })),
        applications: applications.map((a) => ({
          title: a.title || a.jobTitle || "Application",
          status: a.status || "Submitted",
          createdAt: a.createdAt || null,
        })),
      });
    } catch (err) {
      return res.status(500).send("Failed to load jobs: " + err.message);
    }
  },
};