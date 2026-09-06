const { getParent, canAccessChild } = require("./_helpers");
const { studentAttendanceFilter, attendanceSummary, formatInTimezone, idText } = require("../../../services/tenant/attendanceService");

function summarizeBySubject(entries = []) {
  const map = new Map();
  for (const row of entries) {
    const key = idText(row.subject?._id || row.subject) || "unknown";
    if (!map.has(key)) map.set(key, { title: row.subject?.title || row.subject?.shortTitle || row.subject?.code || "Subject", teacher: row.teacher?.fullName || row.teacher?.name || "—", rows: [] });
    map.get(key).rows.push(row);
  }
  return [...map.values()].map((x) => ({ ...x, sessions: x.rows.length, rate: attendanceSummary(x.rows).rate }));
}

function buildAlerts(summary, entries, timezone) {
  const alerts = [];
  if (summary.rate < 75) alerts.push({ title: "Low attendance alert", date: summary.lastUpdated || "—", message: summary.rate < 50 ? "Attendance is critically low. Please contact the school." : "Attendance is below the recommended threshold." });
  for (const row of entries.filter((x) => x.status === "absent").slice(0, 3)) alerts.push({ title: "Recent absence recorded", date: formatInTimezone(row.sessionAt, timezone) || "—", message: `${row.subject?.title || row.subject?.shortTitle || row.subject?.code || "Subject"} was marked absent.` });
  return alerts.slice(0, 5);
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, Attendance, Subject, Staff } = req.models || {};
      if (!Student || !Attendance || !Subject) return res.status(503).send("Attendance is not available.");
      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");
      const childIds = Array.isArray(parent?.childrenStudentIds) ? parent.childrenStudentIds : [];
      const children = parent && childIds.length
        ? await Student.find({ _id: { $in: childIds }, isDeleted: { $ne: true }, status: { $ne: 'archived' } })
            .select("firstName lastName middleName fullName regNo classId className classLevel academicYear term status photoUrl")
            .sort({ fullName: 1 }).lean()
        : [];
      const timezone = req.tenant?.timezone || "UTC";
      const attendanceByStudent = {};
      let attendanceQuery = childIds.length
        ? Attendance.find({ student: { $in: childIds }, isDeleted: { $ne: true }, migrationQuarantinedAt: null })
            .populate({ path: "subject", model: Subject, select: "code title shortTitle" })
        : null;
      if (attendanceQuery && Staff) attendanceQuery = attendanceQuery.populate({ path: "teacher", model: Staff, select: "fullName name" });
      const allAttendance = attendanceQuery
        ? await attendanceQuery.sort({ sessionAt: -1, createdAt: -1 }).limit(Math.min(2500, Math.max(500, childIds.length * 500))).lean()
        : [];
      const groupedAttendance = new Map();
      for (const row of allAttendance) {
        const key = idText(row.student);
        if (!groupedAttendance.has(key)) groupedAttendance.set(key, []);
        const bucket = groupedAttendance.get(key);
        if (bucket.length < 500) bucket.push(row);
      }
      for (const child of children) {
        const raw = groupedAttendance.get(String(child._id)) || [];
        const base = attendanceSummary(raw);
        const entries = raw.map((r) => ({
          ...r,
          course: r.subject?.title || r.subject?.shortTitle || r.subject?.code || "Subject",
          subject: r.subject?.title || r.subject?.shortTitle || r.subject?.code || "Subject",
          teacher: r.teacher?.fullName || r.teacher?.name || "—",
          time: formatInTimezone(r.sessionAt, timezone) || "—",
          note: r.notes || "—",
          status: String(r.status || "present").toLowerCase(),
          date: formatInTimezone(r.sessionAt || r.attendanceDate, timezone) || "—",
        }));
        const summary = { totalSessions: base.total, present: base.present, absent: base.absent, late: base.late, excused: base.excused, rate: base.rate, lastUpdated: entries[0]?.date || "—", riskNote: base.rate < 50 ? "Attendance is critically low and needs immediate follow-up." : base.rate < 75 ? "Attendance is below the recommended threshold." : "Attendance is on track." };
        attendanceByStudent[String(child._id)] = { summary, entries, courses: summarizeBySubject(raw), alerts: buildAlerts(summary, raw, timezone) };
      }
      const requested = req.query?.student ? String(req.query.student) : "";
      let student = requested && canAccessChild(parent, requested) ? children.find((c) => String(c._id) === requested) || null : null;
      if (!student && children.length) student = children[0];
      return res.render("parents/attendance", { tenant: req.tenant, user, parent, children, student, attendanceByStudent, stats: { children: children.length } });
    } catch (err) {
      console.error("PARENT ATTENDANCE ERROR:", err);
      return res.status(500).send("Failed to load parent attendance page");
    }
  },
};
