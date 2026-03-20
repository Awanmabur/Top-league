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
  timetable: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Timetable, CourseRegistration, Exam } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "My Timetable" },
        "tenant/student/timetable"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const timetableRows = Timetable
        ? await Timetable.find({
            $or: [
              { studentId: student._id },
              { classId: student.classId || null },
              { programId: student.programId || null },
            ],
          })
            .sort({ dayOfWeek: 1, startTime: 1 })
            .lean()
            .catch(() => [])
        : [];

      const registrations = CourseRegistration
        ? await CourseRegistration.find({
            studentId: student._id,
            status: { $in: ["approved", "submitted", "active", "registered"] },
          })
            .lean()
            .catch(() => [])
        : [];

      const exams = Exam
        ? await Exam.find({
            $or: [
              { studentId: student._id },
              { classId: student.classId || null },
              { programId: student.programId || null },
            ],
          })
            .sort({ examDate: 1, date: 1, createdAt: -1 })
            .limit(6)
            .lean()
            .catch(() => [])
        : [];

      const week = timetableRows.map((t) => ({
        day: String(t.dayOfWeek || t.day || "").toLowerCase().slice(0, 3),
        dayLabel: t.dayLabel || t.dayOfWeek || t.day || "Day",
        time: `${t.startTime || ""}${t.endTime ? `–${t.endTime}` : ""}`,
        courseCode: courseCodeFromAny(t),
        courseTitle: courseTitleFromAny(t),
        location: t.room || t.venue || t.location || "TBA",
        type: t.type || t.sessionType || "Class",
      }));

      return renderView(req, res, "tenant/student/timetable", {
        pageTitle: "My Timetable",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        registrations,
        week,
        exams: exams.map((e) => ({
          title: e.title || courseTitleFromAny(e),
          date: e.examDate || e.date || null,
        })),
      });
    } catch (err) {
      return res.status(500).send("Failed to load timetable: " + err.message);
    }
  },
};