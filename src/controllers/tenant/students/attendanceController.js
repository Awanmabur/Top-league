const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");
const {
  studentAttendanceFilter,
  attendanceSummary,
  formatInTimezone,
  idText,
} = require("../../../services/tenant/attendanceService");

module.exports = {
  attendance: async (req, res) => {
    try {
      const { Attendance, Subject, Staff } = req.models || {};
      if (!Attendance || !Subject) return res.status(503).send("Attendance is not available.");
      const { user, student } = await getStudent(req);
      if (!user) return res.redirect("/login");
      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Attendance" },
        "students/attendance"
      );
      if (blocked) return blocked;

      let query = Attendance.find(studentAttendanceFilter(student._id));
      query = query.populate({ path: "subject", model: Subject, select: "code title shortTitle" });
      if (Staff) query = query.populate({ path: "teacher", model: Staff, select: "fullName name" });
      const records = await query.sort({ sessionAt: -1, createdAt: -1 }).limit(500).lean();

      const grouped = new Map();
      for (const row of records) {
        const sid = idText(row.subject?._id || row.subject) || "unknown";
        if (!grouped.has(sid)) grouped.set(sid, { courseCode: row.subject?.code || "", courseTitle: row.subject?.title || row.subject?.shortTitle || "Subject", rows: [] });
        grouped.get(sid).rows.push(row);
      }
      const courseSummary = [...grouped.values()].map((entry) => {
        const summary = attendanceSummary(entry.rows);
        return {
          courseCode: entry.courseCode,
          courseTitle: entry.courseTitle,
          total: summary.total,
          attended: summary.attended,
          missed: summary.absent,
          late: summary.late,
          excused: summary.excused,
          percentage: summary.rate,
          trend: summary.rate >= 90 ? "Strong" : summary.rate >= 75 ? "On track" : "Needs attention",
        };
      });
      const overall = attendanceSummary(records);
      const timezone = req.tenant?.timezone || "UTC";

      return renderView(req, res, "students/attendance", {
        pageTitle: "Attendance",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta: academicMeta(student),
        overview: {
          overallPct: overall.rate,
          total: overall.total,
          attended: overall.attended,
          missed: overall.absent,
          late: overall.late,
          excused: overall.excused,
          atRiskCount: courseSummary.filter((c) => c.percentage < 75).length,
        },
        courseSummary,
        records: records.map((r) => ({
          date: r.sessionAt || r.attendanceDate || r.createdAt || null,
          dateLabel: formatInTimezone(r.sessionAt || r.attendanceDate, timezone),
          courseCode: r.subject?.code || "",
          courseTitle: r.subject?.title || r.subject?.shortTitle || "Subject",
          teacherName: r.teacher?.fullName || r.teacher?.name || "",
          status: String(r.status || "present").toLowerCase(),
          remark: r.notes || "",
        })),
      });
    } catch (err) {
      console.error("STUDENT ATTENDANCE ERROR:", err);
      return res.status(500).send("Failed to load attendance.");
    }
  },
};
