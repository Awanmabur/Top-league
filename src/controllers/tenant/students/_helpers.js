const mongoose = require("mongoose");

function isObjId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ""));
}

function lowerEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function titleCase(v) {
  return String(v || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * JWT-only: req.user comes from requireTenantAuth middleware
 */
async function getAuthUser(req) {
  const { User } = req.models || {};
  if (!User) return null;

  const userId = req.user?.userId;
  if (!userId || !isObjId(userId)) return null;

  return User.findOne({ _id: userId, deletedAt: null })
    .select("_id email firstName lastName fullName roles status tokenVersion studentId")
    .lean();
}

async function getStudent(req) {
  const { Student } = req.models || {};
  const user = await getAuthUser(req);

  if (!user || !Student) return { user, student: null };

  let student = null;

  if (user.studentId && isObjId(user.studentId)) {
    student = await Student.findOne({
      _id: user.studentId,
      isDeleted: { $ne: true },
    }).lean();
  }

  if (!student) {
    student = await Student.findOne({
      userId: user._id,
      isDeleted: { $ne: true },
    }).lean();
  }

  if (!student && user.email) {
    student = await Student.findOne({
      email: lowerEmail(user.email),
      isDeleted: { $ne: true },
    }).lean();
  }

  return { user, student };
}

function flashBag(req) {
  return {
    success: req.flash?.("success") || [],
    error: req.flash?.("error") || [],
    warning: req.flash?.("warning") || [],
    info: req.flash?.("info") || [],
  };
}

function getStudentDisplayName(student, user) {
  return (
    student?.fullName ||
    [student?.firstName, student?.lastName].filter(Boolean).join(" ") ||
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    "Student"
  );
}

function mustHaveStudent(res, data, viewName) {
  if (!data.user) return res.redirect("/login");

  if (!data.student) {
    return res.status(403).render(viewName, {
      tenant: data.tenant,
      user: data.user,
      student: null,
      studentName: getStudentDisplayName(data.student, data.user),
      pageTitle: data.pageTitle || "Student Portal",
      currentPath: data.currentPath || "",
      flash: data.flash || { success: [], error: [], warning: [], info: [] },
      error:
        "Student profile not found. Contact admin to complete your registration.",
    });
  }

  return null;
}

function academicMeta(student) {
  return {
    studentNumber:
      student?.studentNumber ||
      student?.registrationNumber ||
      student?.admissionNumber ||
      student?.studentId ||
      "N/A",
    program:
      student?.programName ||
      student?.program ||
      student?.className ||
      "Class not set",
    level:
      student?.levelName ||
      student?.yearName ||
      student?.year ||
      student?.level ||
      "Level not set",
    semester:
      student?.currentSemester ||
      student?.semester ||
      student?.semesterName ||
      "Current Semester",
    academicYear:
      student?.academicYear ||
      student?.yearLabel ||
      "Current Academic Year",
    faculty: student?.facultyName || student?.faculty || "",
    department: student?.departmentName || student?.department || "",
  };
}

function courseCodeFromAny(item) {
  return (
    item?.courseCode ||
    item?.code ||
    item?.course?.code ||
    item?.courseId?.code ||
    item?.subjectCode ||
    ""
  );
}

function courseTitleFromAny(item) {
  return (
    item?.courseTitle ||
    item?.title ||
    item?.course?.title ||
    item?.courseId?.title ||
    item?.subject ||
    item?.name ||
      "Untitled Subject"
  );
}

function registrationStatus(item) {
  return String(item?.status || item?.approvalStatus || "pending").toLowerCase();
}

function attendanceStatus(item) {
  return String(item?.status || "").toLowerCase();
}

function renderView(req, res, viewName, payload = {}) {
  const base = {
    tenant: req.tenant,
    currentPath: req.originalUrl,
    flash: flashBag(req),
  };

  return res.render(viewName, { ...base, ...payload }, (err, html) => {
    if (err) return res.status(500).send(`Render failed: ${err.message}`);
    return res.send(html);
  });
}

module.exports = {
  isObjId,
  lowerEmail,
  num,
  safeArray,
  titleCase,
  getAuthUser,
  getStudent,
  flashBag,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  courseCodeFromAny,
  courseTitleFromAny,
  registrationStatus,
  attendanceStatus,
  renderView,
};