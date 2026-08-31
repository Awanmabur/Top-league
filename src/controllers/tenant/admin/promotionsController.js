const mongoose = require("mongoose");
const { getSchoolUnits } = require("../../../utils/academicStructure");
const {
  applyPromotionBatch,
  normalizeAcademicYear,
  normalizePromotionStatus,
  csvCell,
} = require("../../../services/tenant/promotionService");

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

      const [total, students, classes, logs, studentStatusRows] = await Promise.all([
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
        Student.aggregate([
          { $match: { isDeleted: { $ne: true } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
      ]);
      const studentStatusCounts = Object.fromEntries(
        studentStatusRows.map((row) => [String(row._id || ""), Number(row.count || 0)])
      );
      const totalStudents = Object.values(studentStatusCounts).reduce((sum, value) => sum + Number(value || 0), 0);
      const activeStudents = studentStatusCounts.active || 0;
      const graduatedStudents = studentStatusCounts.graduated || 0;

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
      const { Class } = req.models;
      const ids = [...new Set(safeStr(req.body.ids, 5000).split(",").map((s) => s.trim()).filter(isOid))].slice(0, 200);
      if (!ids.length) {
        req.flash?.("error", "Select active students to promote.");
        return res.redirect("/admin/promotions");
      }

      const toAcademicYear = normalizeAcademicYear(req.body.toAcademicYear);
      const toTerm = Math.max(1, Math.min(3, toInt(req.body.toTerm || req.body.toSemester, 1)));
      const toStatus = normalizePromotionStatus(req.body.toStatus || "active");
      const toClassId = safeStr(req.body.toClassId || req.body.toClassGroup, 80);
      const reason = safeStr(req.body.reason, 300);
      if (!toAcademicYear || !toStatus) throw new Error("A valid destination academic year and status are required.");

      let destinationClass = null;
      if (toStatus !== "graduated") {
        if (!isOid(toClassId)) throw new Error("Destination class is required.");
        destinationClass = await Class.findOne({ _id: toClassId, status: "active" }).lean();
        if (!destinationClass) throw new Error("Selected destination class is not Active or was not found.");
      }

      const result = await applyPromotionBatch(req, {
        ids, destinationClass, toAcademicYear, toTerm, toStatus, reason, actorId: actorId(req),
      });
      req.flash?.("success", `Promotion batch ${result.batchId} complete. Updated ${result.changed} student(s), skipped ${result.skipped}.`);
      return res.redirect("/admin/promotions");
    } catch (err) {
      console.error("PROMOTIONS APPLY ERROR:", err);
      req.flash?.("error", err.message || "Failed to apply promotions.");
      return res.redirect("/admin/promotions");
    }
  },

  async exportCsv(req, res) {
    try {
      const { PromotionLog } = req.models;
      if (!PromotionLog) return res.status(503).send("Promotion history is unavailable.");
      const logs = await PromotionLog.find({}).populate("student", "fullName regNo").sort({ createdAt: -1, _id: -1 }).limit(10000).lean();
      const header = ["Batch ID","Action","Student","Registration No","From Year","To Year","From Class","To Class","From Term","To Term","From Status","To Status","Reason","Created At"];
      const lines = [header.map(csvCell).join(",")];
      for (const row of logs) {
        lines.push([
          row.batchId, row.action, row.student?.fullName || "", row.student?.regNo || "",
          row.fromAcademicYear, row.toAcademicYear, row.fromClassLevel || row.fromYearLevel, row.toClassLevel || row.toYearLevel,
          row.fromTerm || row.fromSemester, row.toTerm || row.toSemester, row.fromStatus, row.toStatus, row.reason,
          row.createdAt?.toISOString?.() || row.createdAt || "",
        ].map(csvCell).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="promotion-history-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send(`\uFEFF${lines.join("\n")}`);
    } catch (err) {
      console.error("PROMOTIONS EXPORT ERROR:", err);
      return res.status(500).send("Failed to export promotion history.");
    }
  },
};
