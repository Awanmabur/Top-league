const { getLecturer } = require("./_helpers");

module.exports = {
  async courses(req, res) {
    try {
      const { Course, ClassSection } = req.models || {};
      const { user, lecturer } = await getLecturer(req);
      if (!user) return res.redirect("/login");

      let courses = [];
      let sections = [];

      if (lecturer && ClassSection) {
        sections = await ClassSection.find({ lecturerStaffId: lecturer._id }).lean().catch(() => []);
      }

      if (Course && sections.length) {
        const courseIds = [...new Set(sections.map(s => String(s.courseId || "")).filter(Boolean))];
        courses = await Course.find({ _id: { $in: courseIds } }).sort({ title: 1 }).lean().catch(() => []);
      }

      return res.render("tenant/lecturer/courses", {
        tenant: req.tenant,
        user,
        lecturer,
        courses,
        sections,
        error: lecturer ? null : "Lecturer profile not found. Contact admin."
      });
    } catch (err) {
      console.error("LECTURER COURSES ERROR:", err);
      return res.status(500).send("Failed to load lecturer courses");
    }
  }
};
