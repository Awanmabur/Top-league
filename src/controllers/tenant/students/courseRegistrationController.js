const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
  courseCodeFromAny,
  courseTitleFromAny,
  registrationStatus,
  num,
} = require("./_helpers");

module.exports = {
  courseRegistration: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { Course, CourseRegistration, RegistrationWindow, Hold } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Course Registration" },
        "tenant/student/course-registration"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const registrations = CourseRegistration
        ? await CourseRegistration.find({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const availableCourses = Course
        ? await Course.find({ isDeleted: { $ne: true } })
            .sort({ code: 1, title: 1 })
            .lean()
            .catch(() => [])
        : [];

      const windowInfo = RegistrationWindow
        ? await RegistrationWindow.findOne({
            $or: [
              { isActive: true },
              { status: "open" },
              { academicYear: meta.academicYear, semester: meta.semester },
            ],
          })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => null)
        : null;

      const holds = Hold
        ? await Hold.find({
            $or: [{ studentId: student._id }, { userId: user._id }],
            status: { $nin: ["cleared", "resolved"] },
          })
            .lean()
            .catch(() => [])
        : [];

      const registeredMap = new Map();
      for (const item of registrations) {
        registeredMap.set(courseCodeFromAny(item), item);
      }

      const registeredCourses = registrations.map((r) => ({
        id: String(r._id),
        courseCode: courseCodeFromAny(r),
        courseTitle: courseTitleFromAny(r),
        credits: num(r.credits ?? r.creditUnits ?? r.courseCredit ?? 0),
        status: registrationStatus(r),
        semester: r.semester || meta.semester,
        notes: r.notes || "",
      }));

      const catalogue = availableCourses.map((c) => {
        const code = courseCodeFromAny(c);
        const reg = registeredMap.get(code);

        return {
          id: String(c._id),
          courseCode: code,
          courseTitle: courseTitleFromAny(c),
          credits: num(c.credits ?? c.creditUnits ?? c.units ?? 0),
          department: c.department || c.departmentName || "",
          level: c.level || c.year || "",
          semester: c.semester || meta.semester,
          type: c.type || c.category || "Course",
          schedule:
            c.schedule ||
            c.scheduleText ||
            c.daysLabel ||
            "See timetable",
          prereq: c.prerequisite || c.prerequisites || "",
          isRegistered: !!reg,
          regStatus: reg ? registrationStatus(reg) : "available",
        };
      });

      const totals = {
        minCredits: num(student?.minCredits ?? 12),
        maxCredits: num(student?.maxCredits ?? 21),
        registeredCredits: registeredCourses.reduce((s, c) => s + num(c.credits), 0),
        registeredCourses: registeredCourses.length,
        holds: holds.length,
      };

      return renderView(req, res, "tenant/student/course-registration", {
        pageTitle: "Course Registration",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        windowInfo,
        holds,
        totals,
        registeredCourses,
        catalogue,
      });
    } catch (err) {
      return res.status(500).send("Failed to load course registration: " + err.message);
    }
  },
};