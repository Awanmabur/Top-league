const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  num,
  courseCodeFromAny,
  courseTitleFromAny,
} = require("./_helpers");

module.exports = {
  results: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Result } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        {
          tenant: req.tenant,
          user,
          student,
          currentPath: req.originalUrl,
          pageTitle: "Results",
        },
        "students/results"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const results = Result
        ? await Result.find({ studentId: student._id })
            .sort({ academicYear: -1, semester: -1, publishedAt: -1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const rows = results.map((r) => ({
        id: String(r._id),
        academicYear: r.academicYear || meta.academicYear,
        semester: r.semester || meta.semester,
        courseCode: courseCodeFromAny(r),
        courseTitle: courseTitleFromAny(r),
        cat: num(r.caMarks ?? r.coursework ?? r.continuousAssessment),
        exam: num(r.examMarks ?? r.finalExam ?? r.exam),
        total: num(r.totalMarks ?? r.score ?? r.percentage),
        grade: r.grade || r.letterGrade || "-",
        remark: r.remark || r.status || (num(r.totalMarks ?? r.score ?? r.percentage) >= 50 ? "Pass" : "Fail"),
        publishedAt: r.publishedAt || r.createdAt || null,
      }));

      const summary = {
        totalCourses: rows.length,
        passed: rows.filter((r) => String(r.remark).toLowerCase().includes("pass") || r.total >= 50).length,
        failed: rows.filter((r) => !(String(r.remark).toLowerCase().includes("pass") || r.total >= 50)).length,
        average: rows.length ? Math.round(rows.reduce((s, r) => s + num(r.total), 0) / rows.length) : 0,
      };

      return renderView(req, res, "students/results", {
        pageTitle: "Results",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        results: rows,
        summary,
      });
    } catch (err) {
      return res.status(500).send("Failed to load results: " + err.message);
    }
  },
};