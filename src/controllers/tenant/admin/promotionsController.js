const mongoose = require("mongoose");

const SCHOOL_LEVELS = ["nursery", "primary", "secondary"];
const CLASS_LEVELS = [
  "BABY",
  "MIDDLE",
  "TOP",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
];
const STUDENT_STATUSES = ["active", "on_hold", "suspended", "graduated", "archived"];

function safeStr(v, max = 2000) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toInt(v, def) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : def;
}

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function actorId(req) {
  const raw = req.user?._id || req.user?.userId || req.session?.tenantUser?.id || null;
  return raw && isOid(raw) ? raw : null;
}

function normalizeSchoolLevel(value) {
  const v = safeStr(value, 30).toLowerCase();
  return SCHOOL_LEVELS.includes(v) ? v : "";
}

function normalizeClassLevel(value) {
  const v = safeStr(value, 30).toUpperCase();
  return CLASS_LEVELS.includes(v) ? v : "";
}

function normalizeStatus(value, fallback = "") {
  const v = safeStr(value, 30).toLowerCase();
  return STUDENT_STATUSES.includes(v) ? v : fallback;
}

function classPatchFromClass(classDoc, fallback = {}) {
  if (!classDoc) return {};
  return {
    schoolUnitId: safeStr(classDoc.schoolUnitId || fallback.schoolUnitId, 80),
    schoolUnitName: safeStr(classDoc.schoolUnitName || fallback.schoolUnitName, 180),
    schoolUnitCode: safeStr(classDoc.schoolUnitCode || fallback.schoolUnitCode, 40),
    campusId: safeStr(classDoc.campusId || fallback.campusId, 80),
    campusName: safeStr(classDoc.campusName || fallback.campusName, 180),
    campusCode: safeStr(classDoc.campusCode || fallback.campusCode, 40),
    classId: String(classDoc._id || fallback.classId || ""),
    className: safeStr(classDoc.name || fallback.className, 180),
    classCode: safeStr(classDoc.code || fallback.classCode, 40),
    section: safeStr(classDoc.stream || classDoc.sectionName || fallback.section, 40),
    stream: safeStr(classDoc.stream || classDoc.sectionName || fallback.stream, 40),
    schoolLevel: normalizeSchoolLevel(classDoc.levelType || fallback.schoolLevel) || fallback.schoolLevel,
    classLevel: normalizeClassLevel(classDoc.classLevel || fallback.classLevel) || fallback.classLevel,
  };
}

async function recountClassLearners(Student, Class, classIds) {
  if (!Student || !Class) return;
  const ids = [...new Set((classIds || []).filter(Boolean).map(String))];
  for (const id of ids) {
    if (!isOid(id)) continue;
    const count = await Student.countDocuments({
      classId: id,
      isDeleted: { $ne: true },
      status: { $nin: ["archived", "graduated"] },
    });
    await Class.updateOne({ _id: id }, { $set: { enrolledCount: count } }).catch(() => {});
  }
}

function buildStudentFilter(req) {
  const q = safeStr(req.query.q, 120);
  const schoolUnitId = safeStr(req.query.schoolUnitId, 80);
  const campusId = safeStr(req.query.campusId, 80);
  const classId = safeStr(req.query.classId || req.query.classGroup, 80);
  const schoolLevel = normalizeSchoolLevel(req.query.schoolLevel || req.query.program);
  const classLevel = normalizeClassLevel(req.query.classLevel || req.query.yearLevel);
  const term = toInt(req.query.term || req.query.semester, 0);
  const status = normalizeStatus(req.query.status);

  const filter = { isDeleted: { $ne: true } };
  if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
  if (campusId) filter.campusId = campusId;
  if (isOid(classId)) filter.classId = classId;
  if (schoolLevel) filter.schoolLevel = schoolLevel;
  if (classLevel) filter.classLevel = classLevel;
  if ([1, 2, 3].includes(term)) filter.term = term;
  if (status) filter.status = status;

  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { regNo: rx },
      { fullName: rx },
      { email: rx },
      { phone: rx },
      { className: rx },
      { section: rx },
    ];
  }

  return { filter, query: { q, schoolUnitId, campusId, classId, schoolLevel, classLevel, term: term || "", status } };
}

function getSchoolUnits(req) {
  return req.tenantDoc?.settings?.academics?.schoolUnits || req.tenant?.settings?.academics?.schoolUnits || [];
}

function buildStructure(req) {
  return (getSchoolUnits(req) || []).map((schoolUnit) => ({
    id: String(schoolUnit.id || schoolUnit._id || ""),
    name: schoolUnit.name || "",
    code: schoolUnit.code || "",
    campuses: (schoolUnit.campuses || []).map((campus) => ({
      id: String(campus.id || campus._id || ""),
      name: campus.name || "",
      code: campus.code || "",
    })),
  }));
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, Class, PromotionLog } = req.models;
      const { filter, query } = buildStudentFilter(req);

      const page = Math.max(1, toInt(req.query.page, 1));
      const limit = Math.min(50, Math.max(10, toInt(req.query.limit, 24)));
      const skip = (page - 1) * limit;

      const [total, students, classes, logs, totalStudents, activeStudents, graduatedStudents] = await Promise.all([
        Student.countDocuments(filter),
        Student.find(filter)
          .select("regNo fullName email phone schoolUnitName campusName classId className classCode section stream schoolLevel classLevel term academicYear status")
          .sort({ schoolLevel: 1, classLevel: 1, section: 1, fullName: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Class.find({ status: { $ne: "archived" } })
          .select("_id code name schoolUnitId schoolUnitName schoolUnitCode campusId campusName campusCode levelType classLevel sectionName stream academicYear term status")
          .sort({ levelType: 1, classLevel: 1, stream: 1, name: 1 })
          .limit(2000)
          .lean(),
        PromotionLog.find({})
          .populate("student", "fullName regNo")
          .sort({ createdAt: -1, _id: -1 })
          .limit(10)
          .lean(),
        Student.countDocuments({ isDeleted: { $ne: true } }),
        Student.countDocuments({ isDeleted: { $ne: true }, status: "active" }),
        Student.countDocuments({ isDeleted: { $ne: true }, status: "graduated" }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      return res.render("tenant/promotions/index", {
        tenant: req.tenant || null,
        students,
        programs: [],
        classes,
        structure: buildStructure(req),
        classLevels: CLASS_LEVELS,
        logs,
        csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : ""),
        cspNonce: res.locals.cspNonce || "",
        kpis: {
          filtered: total,
          totalStudents,
          activeStudents,
          graduatedStudents,
          logs: logs.length,
          classes: classes.length,
        },
        query: {
          ...query,
          page,
          limit,
          total,
          totalPages,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("PROMOTIONS INDEX ERROR:", err);
      req.flash?.("error", "Failed to load promotions.");
      return res.redirect("/admin");
    }
  },

  async applyBulk(req, res) {
    try {
      const { Student, PromotionLog, Class } = req.models;

      const ids = safeStr(req.body.ids)
        .split(",")
        .map((s) => s.trim())
        .filter(isOid);

      if (!ids.length) {
        req.flash?.("error", "Select students to promote.");
        return res.redirect("/admin/promotions");
      }

      const toAcademicYear = safeStr(req.body.toAcademicYear, 20);
      const toTerm = Math.max(1, Math.min(3, toInt(req.body.toTerm || req.body.toSemester, 1)));
      const toClassId = safeStr(req.body.toClassId || req.body.toClassGroup, 80);
      const toStatus = normalizeStatus(req.body.toStatus, "active");
      const reason = safeStr(req.body.reason, 300);

      if (!toAcademicYear || !isOid(toClassId)) {
        req.flash?.("error", "Destination academic year and class are required.");
        return res.redirect("/admin/promotions");
      }

      const nextClass = await Class.findOne({ _id: toClassId, status: { $ne: "archived" } }).lean();
      if (!nextClass) {
        req.flash?.("error", "Selected destination class was not found.");
        return res.redirect("/admin/promotions");
      }

      const destination = classPatchFromClass(nextClass);

      const students = await Student.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      });

      if (!students.length) {
        req.flash?.("error", "No valid students found.");
        return res.redirect("/admin/promotions");
      }

      let changed = 0;
      let skipped = 0;
      const touchedClassIds = new Set([toClassId]);

      for (const s of students) {
        const noChange =
          safeStr(s.academicYear) === toAcademicYear &&
          Number(s.term || 1) === toTerm &&
          safeStr(s.classId) === toClassId &&
          safeStr(s.classLevel) === safeStr(destination.classLevel) &&
          normalizeStatus(s.status, "active") === toStatus;

        if (noChange) {
          skipped += 1;
          continue;
        }

        if (s.classId) touchedClassIds.add(String(s.classId));

        await PromotionLog.create({
          student: s._id,
          fromAcademicYear: safeStr(s.academicYear),
          toAcademicYear,
          fromSemester: Number(s.term || 1),
          toSemester: toTerm,
          fromTerm: Number(s.term || 1),
          toTerm,
          fromYearLevel: safeStr(s.classLevel),
          toYearLevel: safeStr(destination.classLevel),
          fromClassLevel: safeStr(s.classLevel),
          toClassLevel: safeStr(destination.classLevel),
          fromSchoolLevel: safeStr(s.schoolLevel),
          toSchoolLevel: safeStr(destination.schoolLevel),
          fromClassGroup: isOid(s.classId) ? s.classId : null,
          toClassGroup: nextClass._id,
          fromClassId: safeStr(s.classId),
          toClassId,
          fromSection: safeStr(s.section || s.stream),
          toSection: safeStr(destination.section || destination.stream),
          fromStatus: safeStr(s.status || "active"),
          toStatus,
          reason,
          createdBy: actorId(req),
        });

        s.set({
          ...destination,
          academicYear: toAcademicYear,
          term: toTerm,
          status: toStatus,
          updatedBy: actorId(req),
        });

        await s.save();
        changed += 1;
      }

      await recountClassLearners(Student, Class, Array.from(touchedClassIds));

      req.flash?.("success", `Promotion complete. Updated ${changed} student(s), skipped ${skipped}.`);
      return res.redirect("/admin/promotions");
    } catch (err) {
      console.error("PROMOTIONS APPLY ERROR:", err);
      req.flash?.("error", err.message || "Failed to apply promotions.");
      return res.redirect("/admin/promotions");
    }
  },
};
