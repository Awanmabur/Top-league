const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

const STATUSES = ["active", "inactive", "archived"];

function slugCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function getSchoolUnits(req) {
  return req.tenantDoc?.settings?.academics?.schoolUnits
    || req.tenant?.settings?.academics?.schoolUnits
    || [];
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
      levels: (campus.levels || []).map((level) => ({
        id: String(level.id || level._id || ""),
        name: level.name || "",
        type: level.type || "",
        code: level.code || "",
      })),
    })),
  }));
}

function buildSmartCode(body, klass) {
  const campusCode = slugCode(klass?.campusCode || klass?.campusName || "CAMPUS");
  const classLevel = slugCode(klass?.classLevel || "CLASS");
  const classStream = slugCode(klass?.stream || "A");
  const stream = slugCode(body.name || "STREAM");
  return slugCode(`${campusCode}-${classLevel}-${classStream}-${stream}`);
}

const streamRules = [
  body("name").trim().isLength({ min: 1, max: 100 }).withMessage("Stream name is required."),
  body("code").optional({ checkFalsy: true }).trim().isLength({ min: 1, max: 40 }).withMessage("Code must be 1-40 chars."),
  body("classId").trim().custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage("Valid class is required."),
  body("classTeacher").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid teacher."),
  body("status").optional({ checkFalsy: true }).isIn(STATUSES).withMessage("Invalid status."),
  body("capacity").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("enrolledCount").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = {
  streamRules,

  list: async (req, res) => {
    try {
      const { Stream, Staff, Class } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const levelType = String(req.query.levelType || "").trim();
      const classId = String(req.query.classId || "").trim();
      const schoolUnitId = String(req.query.schoolUnitId || "").trim();
      const campusId = String(req.query.campusId || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (q) {
        filter.$or = [
          { name: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
          { className: { $regex: q, $options: "i" } },
          { classLevel: { $regex: q, $options: "i" } },
          { classStream: { $regex: q, $options: "i" } },
          { room: { $regex: q, $options: "i" } },
          { notes: { $regex: q, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (levelType) filter.levelType = levelType;
      if (classId) filter.classId = classId;
      if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
      if (campusId) filter.campusId = campusId;

      const total = await Stream.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const streams = await Stream.find(filter)
        .populate("classTeacher", "fullName name email role")
        .populate("classId", "name code classLevel stream academicYear term campusName levelType")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = Class
        ? await Class.find({})
            .select("name code schoolUnitId schoolUnitName campusId campusName levelType classLevel stream academicYear term")
            .sort({ createdAt: -1 })
            .lean()
        : [];

      const staffList = Staff
        ? await Staff.find({})
            .select("fullName name role email")
            .sort({ fullName: 1, name: 1 })
            .lean()
        : [];

      const kpis = {
        total,
        active: await Stream.countDocuments({ ...filter, status: "active" }),
        inactive: await Stream.countDocuments({ ...filter, status: "inactive" }),
        archived: await Stream.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/admin/streams/index", {
        tenant: req.tenant || null,
        streams,
        classes,
        staffList,
        structure: buildStructure(req),
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, status, levelType, classId, schoolUnitId, campusId, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("STREAMS LIST ERROR:", err);
      return res.status(500).send("Failed to load streams.");
    }
  },

  create: async (req, res) => {
    const { Stream, Class } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/streams");
    }

    try {
      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/streams");
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass);
      code = slugCode(code);

      const exists = await Stream.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Stream code already exists.");
        return res.redirect("/admin/streams");
      }

      const doc = {
        name,
        code,
        schoolUnitId: klass.schoolUnitId || "",
        schoolUnitName: klass.schoolUnitName || "",
        schoolUnitCode: slugCode(klass.schoolUnitCode || klass.schoolUnitName || "UNIT"),
        campusId: klass.campusId || "",
        campusName: klass.campusName || "",
        campusCode: slugCode(klass.campusCode || klass.campusName || "CAMPUS"),
        levelType: klass.levelType || "primary",
        classId: klass._id,
        className: klass.name || "",
        classCode: klass.code || "",
        classLevel: klass.classLevel || "",
        classStream: klass.stream || "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
        createdBy: req.user?._id || null,
      };

      await Stream.create(doc);
      req.flash?.("success", "Stream created.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("CREATE STREAM ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Stream already exists for that class.");
      else req.flash?.("error", "Failed to create stream.");
      return res.redirect("/admin/streams");
    }
  },

  update: async (req, res) => {
    const { Stream, Class } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/streams");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid stream id.");
        return res.redirect("/admin/streams");
      }

      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/streams");
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass);
      code = slugCode(code);

      const collision = await Stream.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Stream code already exists.");
        return res.redirect("/admin/streams");
      }

      const update = {
        name,
        code,
        schoolUnitId: klass.schoolUnitId || "",
        schoolUnitName: klass.schoolUnitName || "",
        schoolUnitCode: slugCode(klass.schoolUnitCode || klass.schoolUnitName || "UNIT"),
        campusId: klass.campusId || "",
        campusName: klass.campusName || "",
        campusCode: slugCode(klass.campusCode || klass.campusName || "CAMPUS"),
        levelType: klass.levelType || "primary",
        classId: klass._id,
        className: klass.name || "",
        classCode: klass.code || "",
        classLevel: klass.classLevel || "",
        classStream: klass.stream || "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
      };

      await Stream.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Stream updated.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("UPDATE STREAM ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Stream already exists for that class.");
      else req.flash?.("error", "Failed to update stream.");
      return res.redirect("/admin/streams");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Stream } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid stream id.");
        return res.redirect("/admin/streams");
      }
      const next = STATUSES.includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/streams");
      }
      await Stream.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Stream status updated.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("SET STREAM STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/streams");
    }
  },

  remove: async (req, res) => {
    try {
      const { Stream } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid stream id.");
        return res.redirect("/admin/streams");
      }
      await Stream.deleteOne({ _id: id });
      req.flash?.("success", "Stream deleted.");
      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("DELETE STREAM ERROR:", err);
      req.flash?.("error", "Failed to delete stream.");
      return res.redirect("/admin/streams");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Stream } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No streams selected.");
        return res.redirect("/admin/streams");
      }

      if (action === "activate") {
        await Stream.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected streams activated.");
      } else if (action === "deactivate") {
        await Stream.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected streams inactivated.");
      } else if (action === "archive") {
        await Stream.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected streams archived.");
      } else if (action === "delete") {
        await Stream.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected streams deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/streams");
    } catch (err) {
      console.error("STREAM BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/streams");
    }
  },
};
