const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  courseCodeFromAny,
  courseTitleFromAny,
  attendanceStatus,
} = require("./_helpers");

module.exports = {
  attendance: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Attendance } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Attendance" },
        "tenant/student/attendance"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const records = Attendance
        ? await Attendance.find({ studentId: student._id })
            .sort({ date: -1 })
            .limit(300)
            .lean()
            .catch(() => [])
        : [];

      const groupedMap = new Map();

      for (const item of records) {
        const code = courseCodeFromAny(item) || "UNKNOWN";
        const title = courseTitleFromAny(item);
        const current = groupedMap.get(code) || {
          courseCode: code,
          courseTitle: title,
          total: 0,
          attended: 0,
          missed: 0,
          late: 0,
          trend: "Stable",
        };

        current.total += 1;

        const status = attendanceStatus(item);
        if (status === "present") current.attended += 1;
        else if (status === "late") current.late += 1;
        else current.missed += 1;

        groupedMap.set(code, current);
      }

      const courseSummary = [...groupedMap.values()].map((c) => {
        const pct = c.total ? Math.round((c.attended / c.total) * 100) : 0;
        return {
          ...c,
          percentage: pct,
          trend: pct >= 90 ? "Improving" : pct >= 80 ? "Stable" : "Declining",
        };
      });

      const total = records.length;
      const attended = records.filter((r) => attendanceStatus(r) === "present").length;
      const missed = records.filter((r) => {
        const s = attendanceStatus(r);
        return s === "absent" || s === "missed";
      }).length;
      const late = records.filter((r) => attendanceStatus(r) === "late").length;
      const overallPct = total ? Math.round((attended / total) * 100) : 0;

      const atRiskCourses = courseSummary.filter((c) => c.percentage < 80);

      return renderView(req, res, "tenant/student/attendance", {
        pageTitle: "Attendance",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        overview: {
          overallPct,
          total,
          attended,
          missed,
          late,
          atRiskCount: atRiskCourses.length,
        },
        courseSummary,
        records: records.map((r) => ({
          date: r.date || r.createdAt || null,
          courseCode: courseCodeFromAny(r),
          courseTitle: courseTitleFromAny(r),
          status: attendanceStatus(r),
          remark: r.remark || r.notes || "",
        })),
      });
    } catch (err) {
      return res.status(500).send("Failed to load attendance: " + err.message);
    }
  },
};