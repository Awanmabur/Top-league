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
  subjectSelection: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");

      const { CourseRegistration, RegistrationWindow, Hold, Subject } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;

      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Subject Selection" },
        "students/subject-selection"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);

      const registrations = CourseRegistration
        ? await CourseRegistration.find({ studentId: student._id })
            .sort({ createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const subjectOr = [];
      if (student.classId) subjectOr.push({ classId: student.classId });
      if (student.classLevel || student.level) {
        subjectOr.push({ classLevel: student.classLevel || student.level });
      }
      if (student.sectionId) subjectOr.push({ sectionId: student.sectionId });

      const subjectFilter = { status: "active" };
      if (subjectOr.length) subjectFilter.$or = subjectOr;
      else subjectFilter._id = null;

      const availableSubjects = Subject
        ? await Subject.find(subjectFilter)
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

      const registeredSubjects = registrations.map((r) => ({
        id: String(r._id),
        subjectCode: courseCodeFromAny(r),
        subjectTitle: courseTitleFromAny(r),
        credits: num(r.credits ?? r.creditUnits ?? r.courseCredit ?? 0),
        status: registrationStatus(r),
        semester: r.semester || meta.semester,
        notes: r.notes || "",
      }));

      const catalogue = availableSubjects.map((c) => {
        const code = courseCodeFromAny(c);
        const reg = registeredMap.get(code);

        return {
          id: String(c._id),
          subjectCode: code,
          subjectTitle: courseTitleFromAny(c),
          credits: num(c.credits ?? c.creditUnits ?? c.units ?? 0),
          department: c.department || c.departmentName || "",
          level: c.level || c.year || "",
          semester: c.semester || meta.semester,
          type: c.type || c.category || "Subject",
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
        registeredCredits: registeredSubjects.reduce((s, c) => s + num(c.credits), 0),
        registeredSubjects: registeredSubjects.length,
        holds: holds.length,
      };

      return renderView(req, res, "students/subject-selection", {
        pageTitle: "Subject Selection",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        windowInfo,
        holds,
        totals,
        registeredSubjects,
        catalogue,
      });
    } catch (err) {
      return res.status(500).send("Failed to load subject selection: " + err.message);
    }
  },
};