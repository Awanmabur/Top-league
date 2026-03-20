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

const isObjId = (v) => !v || mongoose.Types.ObjectId.isValid(String(v));

const classRules = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 160 })
    .withMessage("Name is required (2-160 chars)."),

  body("code")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 30 })
    .withMessage("Code must be 2-30 chars.")
    .customSanitizer((v) => String(v || "").toUpperCase()),

  body("program")
    .optional({ checkFalsy: true })
    .custom(isObjId)
    .withMessage("Invalid program id."),

  body("department")
    .optional({ checkFalsy: true })
    .custom(isObjId)
    .withMessage("Invalid department id."),

  body("advisor")
    .optional({ checkFalsy: true })
    .custom(isObjId)
    .withMessage("Invalid advisor id."),

  body("academicYear")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 }),

  body("yearOfStudy")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 20 })
    .toInt(),

  body("semester")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 6 })
    .toInt(),

  body("section")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 10 }),

  body("studyMode")
    .optional({ checkFalsy: true })
    .isIn(["day", "evening", "weekend", "online"])
    .withMessage("Invalid study mode."),

  body("intake")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 30 }),

  body("capacity")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 100000 })
    .toInt(),

  body("enrolledCount")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 100000 })
    .toInt(),

  body("meetingRoom")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 }),

  body("campus")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 }),

  body("status")
    .optional({ checkFalsy: true })
    .isIn(["active", "inactive", "archived"])
    .withMessage("Invalid status."),

  body("description")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1200 }),
];

async function buildSmartCode(Program, body) {
  let programCode = "";
  if (body.program && mongoose.Types.ObjectId.isValid(String(body.program))) {
    const p = await Program.findById(body.program).select("code name").lean();
    programCode = p?.code || slugCode(p?.name || "");
  }

  const y = Math.max(0, Math.min(Number(body.yearOfStudy || 1), 20));
  const s = Math.max(0, Math.min(Number(body.semester || 1), 6));
  const sec = String(body.section || "A").trim().toUpperCase() || "A";

  const base = programCode
    ? `${programCode}-Y${y}-S${s}-${sec}`
    : `${String(body.name || "").trim()}-Y${y}-S${s}-${sec}`;

  return slugCode(base);
}

module.exports = {
  classRules,

  list: async (req, res) => {
    try {
      const { Class, Program, Department, Staff } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const program = String(req.query.program || "").trim();
      const department = String(req.query.department || "").trim();
      const academicYear = String(req.query.academicYear || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};

      if (q) {
        filter.$or = [
          { name: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
          { campus: { $regex: q, $options: "i" } },
          { meetingRoom: { $regex: q, $options: "i" } },
          { intake: { $regex: q, $options: "i" } },
          { studyMode: { $regex: q, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (academicYear) filter.academicYear = academicYear;
      if (program && mongoose.Types.ObjectId.isValid(program)) filter.program = program;
      if (department && mongoose.Types.ObjectId.isValid(department)) filter.department = department;

      const total = await Class.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const classes = await Class.find(filter)
        .populate("program", "name code faculty level")
        .populate("department", "name code")
        .populate("advisor", "fullName name email role")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

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
            .select("fullName name email role")
            .sort({ fullName: 1, name: 1 })
            .lean()
        : [];

      const academicYears = (await Class.distinct("academicYear")).filter(Boolean).sort();

      const kpis = {
        total,
        active: await Class.countDocuments({ ...filter, status: "active" }),
        inactive: await Class.countDocuments({ ...filter, status: "inactive" }),
        archived: await Class.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/admin/classes/index", {
        tenant: req.tenant || null,
        classes,
        programsList,
        departmentsList,
        staffList,
        academicYears,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          status,
          program,
          department,
          academicYear,
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
      console.error("CLASSES LIST ERROR:", err);
      return res.status(500).send("Failed to load classes.");
    }
  },

  create: async (req, res) => {
    const { Class, Program } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/classes");
    }

    try {
      const name = String(req.body.name || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = await buildSmartCode(Program, req.body);
      code = slugCode(code);

      const exists = await Class.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Class code already exists.");
        return res.redirect("/admin/classes");
      }

      const doc = {
        name,
        code,
        program: req.body.program && mongoose.Types.ObjectId.isValid(req.body.program) ? req.body.program : null,
        department: req.body.department && mongoose.Types.ObjectId.isValid(req.body.department) ? req.body.department : null,
        advisor: req.body.advisor && mongoose.Types.ObjectId.isValid(req.body.advisor) ? req.body.advisor : null,
        academicYear: String(req.body.academicYear || "").trim().slice(0, 20),
        yearOfStudy: Math.max(0, Math.min(Number(req.body.yearOfStudy || 1), 20)),
        semester: Math.max(0, Math.min(Number(req.body.semester || 1), 6)),
        section: String(req.body.section || "A").trim().slice(0, 10) || "A",
        studyMode: ["day", "evening", "weekend", "online"].includes(req.body.studyMode) ? req.body.studyMode : "day",
        intake: String(req.body.intake || "").trim().slice(0, 30),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        meetingRoom: String(req.body.meetingRoom || "").trim().slice(0, 80),
        campus: String(req.body.campus || "").trim().slice(0, 80),
        status: ["active", "inactive", "archived"].includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
        createdBy: req.user?._id || null,
      };

      await Class.create(doc);

      req.flash?.("success", "Class created.");
      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("CREATE CLASS ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Class code already exists.");
      else req.flash?.("error", "Failed to create class.");
      return res.redirect("/admin/classes");
    }
  },

  update: async (req, res) => {
    const { Class, Program } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/classes");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid class id.");
        return res.redirect("/admin/classes");
      }

      const name = String(req.body.name || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = await buildSmartCode(Program, req.body);
      code = slugCode(code);

      const collision = await Class.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Class code already exists.");
        return res.redirect("/admin/classes");
      }

      const update = {
        name,
        code,
        program: req.body.program && mongoose.Types.ObjectId.isValid(req.body.program) ? req.body.program : null,
        department: req.body.department && mongoose.Types.ObjectId.isValid(req.body.department) ? req.body.department : null,
        advisor: req.body.advisor && mongoose.Types.ObjectId.isValid(req.body.advisor) ? req.body.advisor : null,
        academicYear: String(req.body.academicYear || "").trim().slice(0, 20),
        yearOfStudy: Math.max(0, Math.min(Number(req.body.yearOfStudy || 1), 20)),
        semester: Math.max(0, Math.min(Number(req.body.semester || 1), 6)),
        section: String(req.body.section || "A").trim().slice(0, 10) || "A",
        studyMode: ["day", "evening", "weekend", "online"].includes(req.body.studyMode) ? req.body.studyMode : "day",
        intake: String(req.body.intake || "").trim().slice(0, 30),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        meetingRoom: String(req.body.meetingRoom || "").trim().slice(0, 80),
        campus: String(req.body.campus || "").trim().slice(0, 80),
        status: ["active", "inactive", "archived"].includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
      };

      await Class.updateOne({ _id: id }, { $set: update }, { runValidators: true });

      req.flash?.("success", "Class updated.");
      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("UPDATE CLASS ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Class code already exists.");
      else req.flash?.("error", "Failed to update class.");
      return res.redirect("/admin/classes");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Class } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid class id.");
        return res.redirect("/admin/classes");
      }

      const next = ["active", "inactive", "archived"].includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/classes");
      }

      await Class.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Class status updated.");
      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("SET CLASS STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/classes");
    }
  },

  remove: async (req, res) => {
    try {
      const { Class } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid class id.");
        return res.redirect("/admin/classes");
      }

      await Class.deleteOne({ _id: id });
      req.flash?.("success", "Class deleted.");
      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("DELETE CLASS ERROR:", err);
      req.flash?.("error", "Failed to delete class.");
      return res.redirect("/admin/classes");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Class } = req.models;

      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No classes selected.");
        return res.redirect("/admin/classes");
      }

      if (action === "activate") {
        await Class.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected classes activated.");
      } else if (action === "deactivate") {
        await Class.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected classes inactivated.");
      } else if (action === "archive") {
        await Class.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected classes archived.");
      } else if (action === "delete") {
        await Class.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected classes deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("CLASS BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/classes");
    }
  },
};