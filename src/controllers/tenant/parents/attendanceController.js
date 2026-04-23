const { getParent, canAccessChild } = require("./_helpers");

function normalizeAttendanceRows(rows = []) {
  return rows.map((r) => ({
    ...r,
    course: r.courseName || r.course || r.subject || "Class",
    subject: r.subject || r.courseName || r.course || "Class",
    teacher: r.teacherName || r.teacher || "—",
    time: r.time || r.sessionTime || "—",
    note: r.note || r.remarks || "—",
    status: String(r.status || "present").toLowerCase(),
    date: r.date
      ? new Date(r.date).toLocaleDateString()
      : r.createdAt
        ? new Date(r.createdAt).toLocaleDateString()
        : "—",
  }));
}

function buildAttendanceSummary(entries = []) {
  const totalSessions = entries.length;
  const present = entries.filter((x) => x.status === "present").length;
  const absent = entries.filter((x) => x.status === "absent").length;
  const late = entries.filter((x) => x.status === "late").length;
  const excused = entries.filter((x) => x.status === "excused").length;

  const countedPresent = present + late + excused;
  const rate = totalSessions
    ? Math.round((countedPresent / totalSessions) * 100)
    : 0;

  const lastUpdated = entries.length ? entries[0]?.date || "—" : "—";

  let riskNote = "Attendance is on track.";
  if (rate < 50) riskNote = "Attendance is critically low and needs immediate follow-up.";
  else if (rate < 75) riskNote = "Attendance is below the recommended threshold.";

  return {
    totalSessions,
    present,
    absent,
    late,
    excused,
    rate,
    lastUpdated,
    riskNote,
  };
}

function summarizeAttendanceByCourse(entries = []) {
  const map = new Map();

  for (const row of entries) {
    const title = row.course || row.subject || "Class";

    if (!map.has(title)) {
      map.set(title, {
        title,
        teacher: row.teacher || "—",
        sessions: 0,
        presentWeighted: 0,
      });
    }

    const item = map.get(title);
    item.sessions += 1;

    if (row.status === "present") item.presentWeighted += 1;
    else if (row.status === "late") item.presentWeighted += 0.75;
    else if (row.status === "excused") item.presentWeighted += 1;
  }

  return [...map.values()].map((x) => ({
    ...x,
    rate: x.sessions ? Math.round((x.presentWeighted / x.sessions) * 100) : 0,
  }));
}

function buildAttendanceAlerts(summary, entries = []) {
  const alerts = [];

  if (summary.rate < 75) {
    alerts.push({
      title: "Low attendance alert",
      date: summary.lastUpdated,
      message:
        summary.rate < 50
          ? "Attendance is critically low. Please contact the school."
          : "Attendance is below the recommended threshold.",
    });
  }

  const recentAbsences = entries
    .filter((x) => x.status === "absent")
    .slice(0, 3);

  recentAbsences.forEach((a) => {
    alerts.push({
      title: "Recent absence recorded",
      date: a.date || "—",
      message: `${a.course || a.subject || "Class"} was marked absent.`,
    });
  });

  return alerts.slice(0, 5);
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-ATTENDANCE] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Student, Attendance } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select(
                "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status photoUrl attendanceRate"
              )
              .populate({
                path: "program",
                select: "code name title level faculty",
              })
              .populate({
                path: "classGroup",
                select: "code name title",
              })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      const selectedStudentId = req.query?.student
        ? String(req.query.student)
        : null;

      const attendanceByStudent = {};

      for (const child of children) {
        const rawEntries =
          Attendance
            ? await Attendance.find({
                deletedAt: null,
                $or: [{ student: child._id }, { studentId: child._id }],
              })
                .sort({ date: -1, createdAt: -1 })
                .limit(100)
                .lean()
                .catch(() => [])
            : [];

        const entries = normalizeAttendanceRows(rawEntries);
        const summary = buildAttendanceSummary(entries);
        const courses = summarizeAttendanceByCourse(entries);
        const alerts = buildAttendanceAlerts(summary, entries);

        attendanceByStudent[String(child._id)] = {
          summary,
          entries,
          courses,
          alerts,
        };
      }

      let student = null;

      if (selectedStudentId && canAccessChild(parent, selectedStudentId)) {
        student =
          children.find((c) => String(c._id) === selectedStudentId) || null;
      }

      if (!student && children.length) {
        student = children[0];
      }

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? {
              id: parent._id,
              email: parent.email,
              kids: (parent.childrenStudentIds || []).length,
            }
          : null
      );
      log("children:", children.length);
      log("selectedStudent:", student ? String(student._id) : null);

      return res.render("parents/attendance", {
        tenant: req.tenant,
        user,
        parent,
        children,
        student,
        attendanceByStudent,
        stats: {
          children: children.length,
        },
      });
    } catch (err) {
      console.error("PARENT ATTENDANCE ERROR:", err);
      return res.status(500).send("Failed to load parent attendance page");
    }
  },
};