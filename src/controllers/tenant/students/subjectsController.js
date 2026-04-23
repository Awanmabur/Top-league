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
  subjects: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { CourseRegistration, Assignment, Exam, Attendance, Subject } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "My Subjects" },
        "students/subjects"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      let registrations = CourseRegistration
        ? await CourseRegistration.find({
            studentId: student._id,
            status: { $in: ["approved", "submitted", "active", "registered"] },
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      if (!registrations.length && Subject) {
        const subjectOr = [];
        if (student.classId) subjectOr.push({ classId: student.classId });
        if (student.classLevel || student.level) {
          subjectOr.push({ classLevel: student.classLevel || student.level });
        }
        if (student.sectionId) subjectOr.push({ sectionId: student.sectionId });

        const subjectFilter = { status: "active" };
        if (subjectOr.length) subjectFilter.$or = subjectOr;
        else subjectFilter._id = null;

        registrations = await Subject.find(subjectFilter)
          .sort({ code: 1, title: 1 })
          .lean()
          .catch(() => []);
      }

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

      const subjects = registrations.map((r) => {
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
          subjectCode: code,
          subjectTitle: courseTitleFromAny(r),
          teacher: r.teacherName || r.staffName || r.teacher || "TBA",
          semester: r.semester || meta.semester,
          mode: r.mode || r.deliveryMode || "Subject",
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
        totalSubjects: subjects.length,
        averageProgress: subjects.length
          ? Math.round(subjects.reduce((s, c) => s + num(c.progress), 0) / subjects.length)
          : 0,
        dueAssignments: assignments.filter((a) => {
          const due = new Date(a.dueDate || a.deadline || 0);
          const now = new Date();
          const diff = due.getTime() - now.getTime();
          return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
        }).length,
        examsScheduled: exams.length,
      };

      return renderView(req, res, "students/subjects", {
        pageTitle: "My Subjects",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        kpis,
        subjects,
      });
    } catch (err) {
      return res.status(500).send("Failed to load subjects: " + err.message);
    }
  },
};