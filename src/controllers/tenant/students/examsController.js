const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  courseCodeFromAny,
  courseTitleFromAny,
} = require("./_helpers");

module.exports = {
  exams: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Exam } = req.models;
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
          pageTitle: "Exams",
        },
        "students/exams"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const exams = Exam
        ? await Exam.find({
            $or: [
              { studentId: student._id },
              { classId: student.classId || null },
              { programId: student.programId || null },
            ],
          })
            .sort({ examDate: 1, date: 1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const rows = exams.map((e) => ({
        id: String(e._id),
        courseCode: courseCodeFromAny(e),
        courseTitle: courseTitleFromAny(e),
        date: e.examDate || e.date || null,
        time: `${e.startTime || ""}${e.endTime ? ` - ${e.endTime}` : ""}`.trim() || "TBA",
        venue: e.venue || e.location || e.room || "TBA",
        status: e.status || "Scheduled",
        type: e.type || e.examType || "Exam",
      }));

      const today = new Date();
      const upcoming = rows.filter((r) => r.date && new Date(r.date) >= today).length;

      return renderView(req, res, "students/exams", {
        pageTitle: "Exams",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        exams: rows,
        kpis: {
          total: rows.length,
          upcoming,
          nextExam: rows.find((r) => r.date && new Date(r.date) >= today) || null,
        },
      });
    } catch (err) {
      return res.status(500).send("Failed to load exams: " + err.message);
    }
  },
};