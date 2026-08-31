const { assignmentVisibilityFilterForStudent } = require("../../../services/tenant/assignmentService");
const { studentExamFilter } = require("./examsController");
const { studentAttendanceFilter, attendanceSummary, idText } = require("../../../services/tenant/attendanceService");
const { subjectMatchesStudent } = require("../../../services/tenant/studentSelfServiceService");
const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
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
      const blocked = mustHaveStudent(res, { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "My Subjects" }, "students/subjects");
      if (blocked) return blocked;

      const meta = academicMeta(student);
      const [allScopeSubjects, registrations, assignments, exams, attendance] = await Promise.all([
        Subject.find({ status: "active", isDeleted: { $ne: true } }).sort({ code: 1, title: 1 }).limit(500).lean(),
        CourseRegistration.find({
          studentId: student._id,
          academicYear: String(student.academicYear || ""),
          term: Number(student.term || 0),
          status: "approved",
          isDeleted: { $ne: true },
        }).populate({ path: "subjectId", select: "code title shortTitle weeklyPeriods status classId classLevel sectionId streamId academicYear term isCompulsory isDeleted" }).sort({ createdAt: -1 }).lean(),
        Assignment ? Assignment.find(assignmentVisibilityFilterForStudent(student)).populate({ path: "course", select: "code title shortTitle" }).sort({ dueDate: 1, createdAt: -1 }).lean().catch(() => []) : [],
        Exam ? Exam.find(studentExamFilter(student)).populate({ path: "subject", select: "code title shortTitle" }).sort({ examDate: 1, startTime: 1 }).lean().catch(() => []) : [],
        Attendance ? Attendance.find(studentAttendanceFilter(student._id)).populate({ path: "subject", select: "code title shortTitle" }).lean().catch(() => []) : [],
      ]);

      const selected = new Map();
      for (const subject of allScopeSubjects) {
        if (subject.isCompulsory !== false && subjectMatchesStudent(subject, student)) selected.set(String(subject._id), { subject, registration: null, compulsory: true });
      }
      for (const reg of registrations) {
        const subject = reg.subjectId;
        if (subject && subjectMatchesStudent(subject, student)) selected.set(String(subject._id), { subject, registration: reg, compulsory: subject.isCompulsory !== false });
      }

      const subjects = Array.from(selected.values()).map(({ subject, registration, compulsory }) => {
        const code = String(subject.code || registration?.subjectCode || "").trim();
        const relatedAssignments = assignments.filter((a) => String(a.course?.code || "") === code);
        const relatedAttendance = attendance.filter((a) => String(a.subject?.code || "") === code || idText(a.subject?._id || a.subject) === String(subject._id));
        const relatedExams = exams.filter((e) => String(e.subject?.code || e.subjectCode || "") === code);
        return {
          id: String(subject._id),
          subjectCode: code || "—",
          subjectTitle: subject.title || subject.shortTitle || registration?.subjectTitle || "Subject",
          teacher: "TBA",
          semester: meta.semester,
          mode: compulsory ? "Compulsory" : "Optional",
          progress: 0,
          nextItem: relatedAssignments[0]?.title || relatedExams[0]?.title || "No upcoming activity",
          currentGrade: "-",
          attendancePct: attendanceSummary(relatedAttendance).rate,
          credits: num(subject.weeklyPeriods || registration?.weeklyPeriods || 0),
        };
      });

      const kpis = {
        totalSubjects: subjects.length,
        averageProgress: subjects.length ? Math.round(subjects.reduce((s, c) => s + num(c.progress), 0) / subjects.length) : 0,
        dueAssignments: assignments.filter((a) => { const diff = new Date(a.dueDate || a.deadline || 0).getTime() - Date.now(); return diff >= 0 && diff <= 7 * 86400000; }).length,
        examsScheduled: exams.length,
      };

      return renderView(req, res, "students/subjects", { pageTitle: "My Subjects", user, student, studentName: getStudentDisplayName(student, user), meta, kpis, subjects });
    } catch (err) {
      console.error("STUDENT SUBJECTS ERROR:", err);
      return res.status(500).send("Failed to load subjects.");
    }
  },
};
