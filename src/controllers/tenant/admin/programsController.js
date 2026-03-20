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

const cleanModules = (mods) => {
  const arr = Array.isArray(mods) ? mods : (mods ? [mods] : []);
  return arr
    .map((s) => String(s || "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 80);
};

const programRules = [
  body("name").trim().isLength({ min: 2, max: 160 }).withMessage("Name is required (2-160 chars)."),

  // code optional -> auto-generate if blank
  body("code")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 30 })
    .withMessage("Code must be 2-30 chars.")
    .customSanitizer((v) => String(v || "").toUpperCase()),

  body("faculty").trim().isLength({ min: 2, max: 80 }).withMessage("Faculty is required."),
  body("level").trim().isLength({ min: 2, max: 40 }).withMessage("Level is required."),

  body("duration").optional({ checkFalsy: true }).isInt({ min: 0, max: 20 }).toInt(),
  body("seats").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("fee").optional({ checkFalsy: true }).isFloat({ min: 0, max: 100000000 }).toFloat(),

  body("status")
    .optional({ checkFalsy: true })
    .isIn(["active", "draft", "archived"])
    .withMessage("Invalid status."),

  body("short").optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
  body("reqs").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),

  body("department")
  .notEmpty().withMessage("Department is required.")
  .custom((v) => mongoose.Types.ObjectId.isValid(String(v)))
  .withMessage("Invalid department id."),

   body("durationYears").optional({ checkFalsy: true }).isInt({ min: 0, max: 20 }).toInt(),

];



module.exports = {
  programRules,

  list: async (req, res) => {
  try {
    const { Program, Department, Faculty } = req.models;

    const q = String(req.query.q || "").trim();
    const faculty = String(req.query.faculty || "").trim();
    const level = String(req.query.level || "").trim();
    const status = String(req.query.status || "").trim();
    const department = String(req.query.department || "").trim();

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const perPage = 10;

    const filter = {};

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { code: { $regex: q, $options: "i" } },
        { faculty: { $regex: q, $options: "i" } },
        { level: { $regex: q, $options: "i" } },
      ];
    }

    if (faculty) filter.faculty = faculty;
    if (level) filter.level = level;
    if (status) filter.status = status;

    if (department && mongoose.Types.ObjectId.isValid(department)) {
      filter.department = department;
    }

    const total = await Program.countDocuments(filter);
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const safePage = Math.min(page, totalPages);

    let query = Program.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * perPage)
      .limit(perPage);

    if (Department) {
      query = query.populate({
        path: "department",
        select: "name title code",
        model: Department,
      });
    }

    const programs = await query.lean();

    const faculties = (await Program.distinct("faculty")).filter(Boolean).sort();
    const levels = (await Program.distinct("level")).filter(Boolean).sort();

    const departmentsList = Department
      ? await Department.find({ status: { $ne: "inactive" } })
          .select("name title code")
          .sort({ name: 1, title: 1 })
          .lean()
      : [];

    const facultiesList = Faculty
      ? await Faculty.find({ status: { $ne: "inactive" } })
          .select("name code")
          .sort({ name: 1 })
          .lean()
      : [];

    const kpis = {
      total,
      active: await Program.countDocuments({ ...filter, status: "active" }),
      draft: await Program.countDocuments({ ...filter, status: "draft" }),
      archived: await Program.countDocuments({ ...filter, status: "archived" }),
    };

    return res.render("tenant/admin/programs/index", {
      tenant: req.tenant || null,
      programs,
      facultiesList,
      departmentsList,
      faculties: faculties.length ? faculties : ["Science", "Engineering", "Business", "Education"],
      levels: levels.length ? levels : ["Bachelor", "Master", "Diploma"],
      csrfToken: res.locals.csrfToken || null,
      kpis,
      query: {
        q,
        faculty,
        level,
        status,
        department,
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
    console.error("PROGRAMS LIST ERROR:", err);
    return res.status(500).send("Failed to load programs.");
  }
},

  create: async (req, res) => {
    const { Program } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/programs");
    }

    try {
      const name = String(req.body.name || "").trim();
      const faculty = String(req.body.faculty || "").trim();
      const level = String(req.body.level || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = slugCode(name);
      code = slugCode(code);

      const duration = Math.max(0, Math.min(Number(req.body.duration || 0), 20));
      const seats = Math.max(0, Math.min(Number(req.body.seats || 0), 100000));
      const fee = Math.max(0, Math.min(Number(req.body.fee || 0), 100000000));

      const status = ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : "draft";
      const short = String(req.body.short || "").trim().slice(0, 500);
      const reqs = String(req.body.reqs || "").trim().slice(0, 1200);

      // ✅ this matches your modal input name="modules[]"
      const modules = cleanModules(req.body["modules[]"] ?? req.body.modules);

      const exists = await Program.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Program code already exists.");
        return res.redirect("/admin/programs");
      }

      const department = String(req.body.department || "").trim();
      if (!mongoose.Types.ObjectId.isValid(department)) {
        req.flash?.("error", "Department is required.");
        return res.redirect("/admin/programs");
      }

      const durationYears = Math.max(
        0,
        Math.min(Number(req.body.durationYears ?? req.body.duration ?? 0), 20)
      );

      await Program.create({
        name,
        code,
        department,        // ✅ NEW
        faculty,
        level,
        durationYears,     // ✅ FIX
        seats,
        fee,
        status,
        short,
        reqs,
        modules,
        createdBy: req.user?._id || null,
      });

      req.flash?.("success", "Program created.");
      return res.redirect("/admin/programs");
    } catch (err) {
      console.error("CREATE PROGRAM ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Program code already exists.");
      else req.flash?.("error", "Failed to create program.");
      return res.redirect("/admin/programs");
    }
  },

  update: async (req, res) => {
    const { Program } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/programs");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid program id.");
        return res.redirect("/admin/programs");
      }

      const name = String(req.body.name || "").trim();
      const faculty = String(req.body.faculty || "").trim();
      const level = String(req.body.level || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = slugCode(name);
      code = slugCode(code);

      const collision = await Program.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Program code already exists.");
        return res.redirect("/admin/programs");
      }

      const department = String(req.body.department || "").trim();
      if (!mongoose.Types.ObjectId.isValid(department)) {
        req.flash?.("error", "Department is required.");
        return res.redirect("/admin/programs");
      }

      const update = {
        name,
        code,
        department,  // ✅ NEW
        faculty,
        level,
        durationYears: Math.max(0, Math.min(Number(req.body.durationYears ?? req.body.duration ?? 0), 20)),
        seats: Math.max(0, Math.min(Number(req.body.seats || 0), 100000)),
        fee: Math.max(0, Math.min(Number(req.body.fee || 0), 100000000)),
        status: ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : "draft",
        short: String(req.body.short || "").trim().slice(0, 500),
        reqs: String(req.body.reqs || "").trim().slice(0, 1200),
        modules: cleanModules(req.body["modules[]"] ?? req.body.modules),
      };

      await Program.updateOne({ _id: id }, { $set: update }, { runValidators: true });

      req.flash?.("success", "Program updated.");
      return res.redirect("/admin/programs");
    } catch (err) {
      console.error("UPDATE PROGRAM ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Program code already exists.");
      else req.flash?.("error", "Failed to update program.");
      return res.redirect("/admin/programs");
    }
  },

  archive: async (req, res) => {
    try {
      const { Program } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid program id.");
        return res.redirect("/admin/programs");
      }

      await Program.updateOne({ _id: id }, { $set: { status: "archived" } });
      req.flash?.("success", "Program archived.");
      return res.redirect("/admin/programs");
    } catch (err) {
      console.error("ARCHIVE PROGRAM ERROR:", err);
      req.flash?.("error", "Failed to archive program.");
      return res.redirect("/admin/programs");
    }
  },

  remove: async (req, res) => {
    try {
      const { Program } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid program id.");
        return res.redirect("/admin/programs");
      }

      await Program.deleteOne({ _id: id });
      req.flash?.("success", "Program deleted.");
      return res.redirect("/admin/programs");
    } catch (err) {
      console.error("DELETE PROGRAM ERROR:", err);
      req.flash?.("error", "Failed to delete program.");
      return res.redirect("/admin/programs");
    }
  },

  bulkArchive: async (req, res) => {
    try {
      const { Program } = req.models;
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No programs selected.");
        return res.redirect("/admin/programs");
      }

      await Program.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
      req.flash?.("success", "Selected programs archived.");
      return res.redirect("/admin/programs");
    } catch (err) {
      console.error("BULK ARCHIVE ERROR:", err);
      req.flash?.("error", "Bulk archive failed.");
      return res.redirect("/admin/programs");
    }
  },
};
