const { getParent, canAccessChild } = require("./_helpers");

function fmtTime(v) {
  if (!v) return "—";
  return String(v);
}

function normalizeSlot(row = {}) {
  return {
    ...row,
    day:
      row.day ||
      row.weekday ||
      row.dayName ||
      "Unknown",
    startTime: fmtTime(row.startTime || row.start || row.fromTime),
    endTime: fmtTime(row.endTime || row.end || row.toTime),
    subject: row.subjectName || row.subject || row.courseName || row.course || "Class",
    teacher: row.teacherName || row.teacher || row.lecturerName || "—",
    room: row.room || row.location || row.venue || "—",
    mode: row.mode || row.deliveryMode || "On-campus",
    classGroup: row.classGroupName || row.className || "—",
    notes: row.notes || row.remarks || "—",
  };
}

function orderDays(rows = []) {
  const order = {
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
    Sunday: 7,
  };

  return [...rows].sort((a, b) => {
    const da = order[a.day] || 99;
    const db = order[b.day] || 99;
    if (da !== db) return da - db;
    return String(a.startTime || "").localeCompare(String(b.startTime || ""));
  });
}

function buildGroupedByDay(rows = []) {
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.day]) grouped[row.day] = [];
    grouped[row.day].push(row);
  }
  return grouped;
}

function buildStats(rows = []) {
  const days = new Set(rows.map((r) => r.day).filter(Boolean));
  const onlineCount = rows.filter((r) =>
    String(r.mode || "").toLowerCase().includes("online")
  ).length;

  return {
    totalSessions: rows.length,
    activeDays: days.size,
    onlineSessions: onlineCount,
    onCampusSessions: rows.length - onlineCount,
  };
}

function getTodayName() {
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return names[new Date().getDay()];
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-TIMETABLE] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Student, Timetable, ClassTimetable, Schedule } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select(
                "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status"
              )
              .populate({ path: "program", select: "code name title level faculty" })
              .populate({ path: "classGroup", select: "code name title" })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      const selectedStudentId = req.query?.student ? String(req.query.student) : null;

      let student = null;
      if (selectedStudentId && canAccessChild(parent, selectedStudentId)) {
        student = children.find((c) => String(c._id) === selectedStudentId) || null;
      }
      if (!student && children.length) student = children[0];

      if (!student) {
        return res.render("parents/timetable", {
          tenant: req.tenant,
          user,
          parent,
          children,
          student: null,
          timetableRows: [],
          groupedTimetable: {},
          stats: {
            totalSessions: 0,
            activeDays: 0,
            onlineSessions: 0,
            onCampusSessions: 0,
          },
          todayName: getTodayName(),
          error: "No linked student found for this parent account.",
        });
      }

      const timetableModel = Timetable || ClassTimetable || Schedule || null;

      let rawRows = [];
      if (timetableModel) {
        rawRows = await timetableModel
          .find({
            deletedAt: null,
            $or: [
              { student: student._id },
              { studentId: student._id },
              { classGroup: student.classGroup?._id || student.classGroup },
              { classGroupId: student.classGroup?._id || student.classGroup },
            ],
          })
          .sort({ day: 1, startTime: 1, start: 1 })
          .lean()
          .catch(() => []);
      }

      const timetableRows = orderDays(rawRows.map(normalizeSlot));
      const groupedTimetable = buildGroupedByDay(timetableRows);
      const stats = buildStats(timetableRows);
      const todayName = getTodayName();

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? { id: parent._id, email: parent.email, kids: (parent.childrenStudentIds || []).length }
          : null
      );
      log("children:", children.length);
      log("selectedStudent:", student ? String(student._id) : null);
      log("timetableRows:", timetableRows.length);

      return res.render("parents/timetable", {
        tenant: req.tenant,
        user,
        parent,
        children,
        student,
        timetableRows,
        groupedTimetable,
        stats,
        todayName,
        error: null,
      });
    } catch (err) {
      console.error("PARENT TIMETABLE ERROR:", err);
      return res.status(500).send("Failed to load parent timetable page");
    }
  },
};