const mongoose = require("mongoose");

function safeStr(v) {
  return String(v == null ? "" : v).trim();
}

function toInt(v, def) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : def;
}

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

module.exports = {
  async index(req, res) {
    try {
      const { Student, Subject, Class, PromotionLog } = req.models;

      const q = safeStr(req.query.q);
      const program = safeStr(req.query.program);
      const classGroup = safeStr(req.query.classGroup);
      const yearLevel = safeStr(req.query.yearLevel);
      const status = safeStr(req.query.status);

      const page = Math.max(1, toInt(req.query.page, 1));
      const limit = Math.min(50, Math.max(10, toInt(req.query.limit, 24)));
      const skip = (page - 1) * limit;

      const filter = { isDeleted: { $ne: true } };

      if (program && isOid(program)) filter.program = program;
      if (classGroup && isOid(classGroup)) filter.classGroup = classGroup;
      if (yearLevel) filter.yearLevel = yearLevel;
      if (status) filter.status = status;

      if (q) {
        filter.$or = [
          { regNo: new RegExp(q, "i") },
          { fullName: new RegExp(q, "i") },
          { email: new RegExp(q, "i") },
          { phone: new RegExp(q, "i") },
        ];
      }

      const [
        total,
        students,
        programs,
        classes,
        logs,
        totalStudents,
        activeStudents,
        graduatedStudents,
      ] = await Promise.all([
        Student.countDocuments(filter),
        Student.find(filter)
          .populate("program", "code name title")
          .populate("classGroup", "code name title")
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Subject.find({ status: { $ne: "archived" } })
          .select("code title shortTitle name")
          .sort({ code: 1, title: 1 })
          .limit(1000)
          .lean(),
        Class.find({ isDeleted: { $ne: true } })
          .select("code name title")
          .sort({ code: 1, name: 1 })
          .limit(1000)
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

      return res.render("tenant/admin/promotions/index", {
        tenant: req.tenant || null,
        students,
        programs,
        classes,
        logs,
        csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : ""),
        cspNonce: res.locals.cspNonce || "",
        kpis: {
          filtered: total,
          totalStudents,
          activeStudents,
          graduatedStudents,
          logs: logs.length,
          programs: programs.length,
          classes: classes.length,
        },
        query: {
          q,
          program,
          classGroup,
          yearLevel,
          status,
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
        .filter(Boolean)
        .filter(isOid);

      if (!ids.length) {
        req.flash?.("error", "Select students to promote.");
        return res.redirect("/admin/promotions");
      }

      const toAcademicYear = safeStr(req.body.toAcademicYear);
      const toSemester = Math.max(1, Math.min(6, toInt(req.body.toSemester, 1)));
      const toYearLevel = safeStr(req.body.toYearLevel);
      const toClassGroup = safeStr(req.body.toClassGroup);
      const reason = safeStr(req.body.reason);

      if (!toAcademicYear || !toYearLevel || !isOid(toClassGroup)) {
        req.flash?.("error", "To Academic Year, To Year Level and To Class are required.");
        return res.redirect("/admin/promotions");
      }

      const nextClass = await Class.findById(toClassGroup).select("_id").lean();
      if (!nextClass) {
        req.flash?.("error", "Selected destination class was not found.");
        return res.redirect("/admin/promotions");
      }

      const students = await Student.find({
        _id: { $in: ids },
        isDeleted: { $ne: true },
      });

      if (!students.length) {
        req.flash?.("error", "No valid students found.");
        return res.redirect("/admin/promotions");
      }

      let changed = 0;

      for (const s of students) {
        const noChange =
          safeStr(s.academicYear) === toAcademicYear &&
          Number(s.semester || 1) === toSemester &&
          safeStr(s.yearLevel) === toYearLevel &&
          String(s.classGroup || "") === String(toClassGroup);

        if (noChange) {
          continue;
        }

        await PromotionLog.create({
          student: s._id,
          fromAcademicYear: safeStr(s.academicYear),
          toAcademicYear,
          fromSemester: Number(s.semester || 1),
          toSemester,
          fromYearLevel: safeStr(s.yearLevel),
          toYearLevel,
          fromClassGroup: s.classGroup || null,
          toClassGroup,
          reason,
          createdBy: req.user ? req.user._id : null,
        });

        s.academicYear = toAcademicYear;
        s.semester = toSemester;
        s.yearLevel = toYearLevel;
        s.classGroup = toClassGroup;
        s.updatedBy = req.user ? req.user._id : null;

        await s.save();
        changed += 1;
      }

      req.flash?.("success", `Promoted ${changed} student(s).`);
      return res.redirect("/admin/promotions");
    } catch (err) {
      console.error("PROMOTIONS APPLY ERROR:", err);
      req.flash?.("error", "Failed to apply promotions.");
      return res.redirect("/admin/promotions");
    }
  },
};
