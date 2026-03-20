const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

function slugCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 30);
}

const cleanIds = (v) => {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  return arr
    .map((x) => String(x || "").trim())
    .filter((x) => mongoose.Types.ObjectId.isValid(x));
};

const courseRules = [
  body("title")
    .trim()
    .isLength({ min: 2, max: 180 })
    .withMessage("Title is required (2-180 chars)."),

  body("code")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 30 })
    .withMessage("Code must be 2-30 chars.")
    .customSanitizer((v) => String(v || "").toUpperCase()),

  body("department")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(v))
    .withMessage("Invalid department."),

  body("program")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(v))
    .withMessage("Invalid program."),

  body("yearOfStudy")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 20 })
    .toInt(),

  body("semester")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 6 })
    .toInt(),

  body("credits")
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 60 })
    .toFloat(),

  body("contactHours")
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 500 })
    .toFloat(),

  body("type")
    .optional({ checkFalsy: true })
    .isIn(["core", "elective", "general"])
    .withMessage("Invalid type."),

  body("studyMode")
    .optional({ checkFalsy: true })
    .isIn(["day", "evening", "weekend", "online"])
    .withMessage("Invalid study mode."),

  body("status")
    .optional({ checkFalsy: true })
    .isIn(["active", "draft", "archived"])
    .withMessage("Invalid status."),

  body("coordinator")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(v))
    .withMessage("Invalid coordinator."),

  body("lecturer")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(v))
    .withMessage("Invalid lecturer."),

  body("shortTitle")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 }),

  body("level")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 40 }),

  body("description")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1200 }),

  body("objectives")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1200 }),

  body("outline")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 5000 }),
];

module.exports = {
  courseRules,

  list: async (req, res) => {
    try {
      const { Course, Program, Department, Staff } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const type = String(req.query.type || "").trim();
      const studyMode = String(req.query.studyMode || "").trim();
      const program = String(req.query.program || "").trim();
      const department = String(req.query.department || "").trim();
      const semester = String(req.query.semester || "").trim();
      const yearOfStudy = String(req.query.yearOfStudy || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};

      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { shortTitle: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
          { level: { $regex: q, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (type) filter.type = type;
      if (studyMode) filter.studyMode = studyMode;
      if (program && mongoose.Types.ObjectId.isValid(program)) filter.program = program;
      if (department && mongoose.Types.ObjectId.isValid(department)) filter.department = department;
      if (semester && !Number.isNaN(Number(semester))) filter.semester = Number(semester);
      if (yearOfStudy && !Number.isNaN(Number(yearOfStudy))) filter.yearOfStudy = Number(yearOfStudy);

      const total = await Course.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const courses = await Course.find(filter)
        .populate("program", "name code faculty level")
        .populate("department", "name code")
        .populate("coordinator", "fullName name email role")
        .populate("lecturer", "fullName name email role")
        .populate("prerequisites", "title code")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const normalizedCourses = courses.map((c) => ({
        ...c,
        prerequisitesResolved: Array.isArray(c.prerequisites) ? c.prerequisites : [],
        prerequisites: Array.isArray(c.prerequisites)
          ? c.prerequisites.map((x) => x?._id).filter(Boolean)
          : [],
      }));

      const programsList = Program
        ? await Program.find({ status: { $ne: "archived" } })
            .select("name code faculty level")
            .sort({ name: 1 })
            .lean()
        : [];

      const departmentsList = Department
        ? await Department.find({ status: { $ne: "inactive" } })
            .select("name code")
            .sort({ name: 1 })
            .lean()
        : [];

      const staffList = Staff
        ? await Staff.find({})
            .select("fullName name role email")
            .sort({ fullName: 1, name: 1 })
            .lean()
        : [];

      const allCoursesList = await Course.find({})
        .select("title code")
        .sort({ title: 1 })
        .limit(1000)
        .lean();

      const kpis = {
        total,
        active: await Course.countDocuments({ ...filter, status: "active" }),
        draft: await Course.countDocuments({ ...filter, status: "draft" }),
        archived: await Course.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/admin/courses/index", {
        tenant: req.tenant || null,
        courses: normalizedCourses,
        programsList,
        departmentsList,
        staffList,
        allCoursesList,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          status,
          type,
          studyMode,
          program,
          department,
          semester,
          yearOfStudy,
          page: safePage,
          total,
          totalPages,
          perPage,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("COURSES LIST ERROR:", err);
      return res.status(500).send("Failed to load courses.");
    }
  },

  create: async (req, res) => {
    const { Course } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/courses");
    }

    try {
      const title = String(req.body.title || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = slugCode(title);
      code = slugCode(code);

      const exists = await Course.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Course code already exists.");
        return res.redirect("/admin/courses");
      }

      const doc = {
        title,
        code,
        shortTitle: String(req.body.shortTitle || "").trim().slice(0, 80),
        department: req.body.department && mongoose.Types.ObjectId.isValid(req.body.department) ? req.body.department : null,
        program: req.body.program && mongoose.Types.ObjectId.isValid(req.body.program) ? req.body.program : null,
        level: String(req.body.level || "").trim().slice(0, 40),
        yearOfStudy: Math.max(0, Math.min(Number(req.body.yearOfStudy || 1), 20)),
        semester: Math.max(0, Math.min(Number(req.body.semester || 1), 6)),
        credits: Math.max(0, Math.min(Number(req.body.credits || 0), 60)),
        contactHours: Math.max(0, Math.min(Number(req.body.contactHours || 0), 500)),
        type: ["core", "elective", "general"].includes(req.body.type) ? req.body.type : "core",
        studyMode: ["day", "evening", "weekend", "online"].includes(req.body.studyMode) ? req.body.studyMode : "day",
        status: ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
        objectives: String(req.body.objectives || "").trim().slice(0, 1200),
        outline: String(req.body.outline || "").trim().slice(0, 5000),
        prerequisites: cleanIds(req.body["prerequisites[]"] ?? req.body.prerequisites),
        coordinator: req.body.coordinator && mongoose.Types.ObjectId.isValid(req.body.coordinator) ? req.body.coordinator : null,
        lecturer: req.body.lecturer && mongoose.Types.ObjectId.isValid(req.body.lecturer) ? req.body.lecturer : null,
        createdBy: req.user?._id || null,
      };

      await Course.create(doc);

      req.flash?.("success", "Course created.");
      return res.redirect("/admin/courses");
    } catch (err) {
      console.error("CREATE COURSE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Course code already exists.");
      else req.flash?.("error", "Failed to create course.");
      return res.redirect("/admin/courses");
    }
  },

  update: async (req, res) => {
    const { Course } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/courses");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid course id.");
        return res.redirect("/admin/courses");
      }

      const title = String(req.body.title || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = slugCode(title);
      code = slugCode(code);

      const collision = await Course.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Course code already exists.");
        return res.redirect("/admin/courses");
      }

      const update = {
        title,
        code,
        shortTitle: String(req.body.shortTitle || "").trim().slice(0, 80),
        department: req.body.department && mongoose.Types.ObjectId.isValid(req.body.department) ? req.body.department : null,
        program: req.body.program && mongoose.Types.ObjectId.isValid(req.body.program) ? req.body.program : null,
        level: String(req.body.level || "").trim().slice(0, 40),
        yearOfStudy: Math.max(0, Math.min(Number(req.body.yearOfStudy || 1), 20)),
        semester: Math.max(0, Math.min(Number(req.body.semester || 1), 6)),
        credits: Math.max(0, Math.min(Number(req.body.credits || 0), 60)),
        contactHours: Math.max(0, Math.min(Number(req.body.contactHours || 0), 500)),
        type: ["core", "elective", "general"].includes(req.body.type) ? req.body.type : "core",
        studyMode: ["day", "evening", "weekend", "online"].includes(req.body.studyMode) ? req.body.studyMode : "day",
        status: ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
        objectives: String(req.body.objectives || "").trim().slice(0, 1200),
        outline: String(req.body.outline || "").trim().slice(0, 5000),
        prerequisites: cleanIds(req.body["prerequisites[]"] ?? req.body.prerequisites),
        coordinator: req.body.coordinator && mongoose.Types.ObjectId.isValid(req.body.coordinator) ? req.body.coordinator : null,
        lecturer: req.body.lecturer && mongoose.Types.ObjectId.isValid(req.body.lecturer) ? req.body.lecturer : null,
      };

      await Course.updateOne({ _id: id }, { $set: update }, { runValidators: true });

      req.flash?.("success", "Course updated.");
      return res.redirect("/admin/courses");
    } catch (err) {
      console.error("UPDATE COURSE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Course code already exists.");
      else req.flash?.("error", "Failed to update course.");
      return res.redirect("/admin/courses");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Course } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid course id.");
        return res.redirect("/admin/courses");
      }

      const next = ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/courses");
      }

      await Course.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Course status updated.");
      return res.redirect("/admin/courses");
    } catch (err) {
      console.error("SET COURSE STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/courses");
    }
  },

  remove: async (req, res) => {
    try {
      const { Course } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid course id.");
        return res.redirect("/admin/courses");
      }

      await Course.deleteOne({ _id: id });
      req.flash?.("success", "Course deleted.");
      return res.redirect("/admin/courses");
    } catch (err) {
      console.error("DELETE COURSE ERROR:", err);
      req.flash?.("error", "Failed to delete course.");
      return res.redirect("/admin/courses");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Course } = req.models;

      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No courses selected.");
        return res.redirect("/admin/courses");
      }

      if (action === "activate") {
        await Course.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected courses activated.");
      } else if (action === "draft") {
        await Course.updateMany({ _id: { $in: ids } }, { $set: { status: "draft" } });
        req.flash?.("success", "Selected courses set to draft.");
      } else if (action === "archive") {
        await Course.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected courses archived.");
      } else if (action === "delete") {
        await Course.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected courses deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/courses");
    } catch (err) {
      console.error("COURSE BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/courses");
    }
  },
};