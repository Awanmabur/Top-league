const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  courseCodeFromAny,
  courseTitleFromAny,
  num,
} = require("./_helpers");

module.exports = {
  courses: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { CourseRegistration, Assignment, Exam, Attendance, Course } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "My Courses" },
        "tenant/student/courses"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const registrations = CourseRegistration
        ? await CourseRegistration.find({
            studentId: student._id,
            status: { $in: ["approved", "submitted", "active", "registered"] },
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const assignments = Assignment
        ? await Assignment.find({
            $or: [
              { studentId: student._id },
              { assignedToStudents: student._id },
              { classId: student.classId || null },
              { programId: student.programId || null },
            ],
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
            .lean()
            .catch(() => [])
        : [];

      const attendance = Attendance
        ? await Attendance.find({ studentId: student._id })
            .lean()
            .catch(() => [])
        : [];

      const courses = registrations.map((r) => {
        const code = courseCodeFromAny(r);
        const relatedAssignments = assignments.filter((a) => courseCodeFromAny(a) === code);
        const relatedAttendance = attendance.filter((a) => courseCodeFromAny(a) === code);
        const relatedExams = exams.filter((e) => courseCodeFromAny(e) === code);

        const present = relatedAttendance.filter(
          (a) => String(a.status || "").toLowerCase() === "present"
        ).length;

        const attendancePct = relatedAttendance.length
          ? Math.round((present / relatedAttendance.length) * 100)
          : 0;

        return {
          id: String(r._id),
          courseCode: code,
          courseTitle: courseTitleFromAny(r),
          lecturer: r.lecturerName || r.lecturer || "TBA",
          semester: r.semester || meta.semester,
          mode: r.mode || r.deliveryMode || "Course",
          progress: num(r.progress ?? r.completionRate ?? 0),
          nextItem:
            relatedAssignments[0]?.title ||
            relatedExams[0]?.title ||
            "No upcoming activity",
          currentGrade: r.grade || r.currentGrade || "-",
          attendancePct,
          credits: num(r.credits ?? 0),
        };
      });

      const kpis = {
        totalCourses: courses.length,
        averageProgress: courses.length
          ? Math.round(courses.reduce((s, c) => s + num(c.progress), 0) / courses.length)
          : 0,
        dueAssignments: assignments.filter((a) => {
          const due = new Date(a.dueDate || a.deadline || 0);
          const now = new Date();
          const diff = due.getTime() - now.getTime();
          return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
        }).length,
        examsScheduled: exams.length,
      };

      return renderView(req, res, "tenant/student/courses", {
        pageTitle: "My Courses",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        kpis,
        courses,
      });
    } catch (err) {
      return res.status(500).send("Failed to load courses: " + err.message);
    }
  },
};