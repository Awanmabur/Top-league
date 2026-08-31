const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");
const {
  subjectMatchesStudent,
  findRegistrationWindow,
  blockingRegistrationHolds,
  requestSubjectRegistration,
  dropSubjectRegistration,
  idText,
} = require("../../../services/tenant/studentSelfServiceService");

const actorUserId = (req, user) => req.user?._id || req.user?.userId || user?._id || null;

async function loadSubjectSelection(req, student) {
  const { CourseRegistration, RegistrationWindow, StudentHold, Subject } = req.models;
  const academicYear = String(student.academicYear || "").trim();
  const term = Number(student.term || 0);

  const subjectQuery = { status: "active" };
  if (academicYear) subjectQuery.$or = [{ academicYear }, { academicYear: "" }, { academicYear: { $exists: false } }];
  const [registrationDocs, candidateSubjects, windowInfo, holds] = await Promise.all([
    CourseRegistration.find({
      studentId: student._id,
      academicYear,
      term,
      isDeleted: { $ne: true },
    })
      .populate("subjectId", "code title shortTitle weeklyPeriods isCompulsory classId classLevel sectionId streamId academicYear term status")
      .sort({ createdAt: -1 })
      .lean(),
    Subject.find(subjectQuery).sort({ code: 1, title: 1 }).limit(500).lean(),
    findRegistrationWindow(RegistrationWindow, student),
    blockingRegistrationHolds(StudentHold, student),
  ]);

  const subjects = candidateSubjects.filter((subject) => subjectMatchesStudent(subject, student));
  const registrations = registrationDocs.filter((row) => !row.subjectId || subjectMatchesStudent(row.subjectId, student));
  const registrationBySubject = new Map(registrations.map((row) => [idText(row.subjectId?._id || row.subjectId), row]));

  const registeredSubjects = [];
  for (const subject of subjects) {
    const registration = registrationBySubject.get(idText(subject._id));
    const compulsory = subject.isCompulsory !== false;
    if (!compulsory && !registration) continue;
    if (registration && ["rejected", "dropped"].includes(registration.status)) continue;
    registeredSubjects.push({
      id: registration?._id ? String(registration._id) : `compulsory:${subject._id}`,
      subjectId: String(subject._id),
      subjectCode: subject.code || "",
      subjectTitle: subject.title || subject.shortTitle || "Subject",
      weeklyPeriods: Number(subject.weeklyPeriods || registration?.weeklyPeriods || 0),
      status: compulsory ? "compulsory" : registration?.status || "pending",
      term,
      canDrop: !compulsory && !!registration && !!windowInfo?.allowDrop && ["pending", "approved"].includes(registration.status),
      revision: Number(registration?.revision || 0),
    });
  }

  const catalogue = subjects.map((subject) => {
    const registration = registrationBySubject.get(idText(subject._id));
    const compulsory = subject.isCompulsory !== false;
    const activeRegistration = registration && ["pending", "approved"].includes(registration.status) ? registration : null;
    return {
      id: String(subject._id),
      subjectCode: subject.code || "",
      subjectTitle: subject.title || subject.shortTitle || "Subject",
      weeklyPeriods: Number(subject.weeklyPeriods || 0),
      category: subject.category || "general",
      isCompulsory: compulsory,
      registrationId: registration?._id ? String(registration._id) : "",
      regStatus: compulsory ? "compulsory" : activeRegistration?.status || registration?.status || "available",
      canAdd: !compulsory && !activeRegistration && !!windowInfo && holds.length === 0,
      canDrop: !compulsory && !!activeRegistration && !!windowInfo?.allowDrop,
    };
  });

  const optionalActive = registrations.filter((row) => ["pending", "approved"].includes(row.status)).length;
  return {
    windowInfo,
    holds,
    registeredSubjects,
    catalogue,
    totals: {
      compulsory: subjects.filter((s) => s.isCompulsory !== false).length,
      optionalSelected: optionalActive,
      maxOptional: Number(windowInfo?.maxOptionalSubjects || 0),
      holds: holds.length,
    },
  };
}

module.exports = {
  subjectSelection: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");
      const blocked = mustHaveStudent(res, { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Subject Selection" }, "students/subject-selection");
      if (blocked) return blocked;
      const data = await loadSubjectSelection(req, student);
      return renderView(req, res, "students/subject-selection", {
        pageTitle: "Subject Selection",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta: academicMeta(student),
        ...data,
      });
    } catch (err) {
      console.error("SUBJECT SELECTION ERROR:", err);
      return res.status(500).send("Failed to load subject selection.");
    }
  },

  add: async (req, res) => {
    try {
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student) throw new Error("Student profile not found.");
      await requestSubjectRegistration(req.models, {
        student: got.student,
        subjectId: req.params.subjectId,
        actorUserId: actorUserId(req, got.user),
      });
      req.flash?.("success", "Subject selection submitted for review.");
    } catch (err) {
      req.flash?.("error", err.message || "Failed to select subject.");
    }
    return res.redirect("/student/subject-selection");
  },

  drop: async (req, res) => {
    try {
      const got = await getStudent(req);
      if (!got?.user) return res.redirect("/login");
      if (!got?.student) throw new Error("Student profile not found.");
      await dropSubjectRegistration(req.models, {
        student: got.student,
        registrationId: req.params.registrationId,
        actorUserId: actorUserId(req, got.user),
      });
      req.flash?.("success", "Subject selection dropped.");
    } catch (err) {
      req.flash?.("error", err.message || "Failed to drop subject.");
    }
    return res.redirect("/student/subject-selection");
  },

  _test: { loadSubjectSelection },
};
