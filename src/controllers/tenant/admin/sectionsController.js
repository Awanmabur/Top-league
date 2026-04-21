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

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function buildSmartCode(body, klass, stream) {
  const campusCode = slugCode(klass?.campusCode || klass?.campusName || "CAMPUS");
  const classLevel = slugCode(klass?.classLevel || "CLASS");
  const classStream = slugCode(stream?.name || klass?.streamName || klass?.stream || "A");
  const section = slugCode(body.name || "SECTION");
  return slugCode(`${campusCode}-${classLevel}-${classStream}-${section}`);
}

const sectionRules = [
  body("name").trim().isLength({ min: 1, max: 100 }).withMessage("Section/stream name is required."),
  body("code").optional({ checkFalsy: true }).trim().isLength({ min: 1, max: 40 }).withMessage("Code must be 1-40 chars."),
  body("classId").trim().custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage("Valid class is required."),
  body("streamId").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid stream."),
  body("classTeacher").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid teacher."),
  body("status").optional({ checkFalsy: true }).isIn(STATUSES).withMessage("Invalid status."),
  body("capacity").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("enrolledCount").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = {
  sectionRules,

  list: async (req, res) => {
    try {
      const { Section, Staff, Class, Stream } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const levelType = String(req.query.levelType || "").trim();
      const classId = String(req.query.classId || "").trim();
      const streamId = String(req.query.streamId || "").trim();
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
          { streamName: { $regex: q, $options: "i" } },
          { streamCode: { $regex: q, $options: "i" } },
          { room: { $regex: q, $options: "i" } },
          { notes: { $regex: q, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (levelType) filter.levelType = levelType;
      if (classId) filter.classId = classId;
      if (streamId) filter.streamId = streamId;
      if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
      if (campusId) filter.campusId = campusId;

      const total = await Section.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const sections = await Section.find(filter)
        .populate("classTeacher", "fullName name email role")
        .populate("classId", "name code classLevel stream academicYear term campusName levelType")
        .populate("streamId", "name code classId className sectionId sectionName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = Class
        ? await Class.find({})
            .select("name code schoolUnitId schoolUnitName campusId campusName levelType classLevel stream streamName academicYear term")
            .sort({ createdAt: -1 })
            .lean()
        : [];

      const streams = Stream
        ? await Stream.find({})
            .select("name code schoolUnitId schoolUnitName campusId campusName levelType classId className classLevel classStream sectionId sectionName sectionCode status")
            .sort({ name: 1, createdAt: -1 })
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
        active: await Section.countDocuments({ ...filter, status: "active" }),
        inactive: await Section.countDocuments({ ...filter, status: "inactive" }),
        archived: await Section.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/admin/sections/index", {
        tenant: req.tenant || null,
        sections,
        classes,
        streams,
        staffList,
        structure: buildStructure(req),
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, status, levelType, classId, streamId, schoolUnitId, campusId, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("SECTIONS LIST ERROR:", err);
      return res.status(500).send("Failed to load sections.");
    }
  },

  create: async (req, res) => {
    const { Section, Class, Stream } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/sections");
    }

    try {
      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/sections");
      }

      let stream = null;
      if (req.body.streamId) {
        stream = Stream ? await Stream.findById(req.body.streamId).lean() : null;
        if (!stream) {
          req.flash?.("error", "Selected stream was not found.");
          return res.redirect("/admin/sections");
        }
        if (stream.classId && !sameId(stream.classId, klass._id)) {
          req.flash?.("error", "Selected stream does not belong to the selected class.");
          return res.redirect("/admin/sections");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, stream);
      code = slugCode(code);

      const exists = await Section.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Section code already exists.");
        return res.redirect("/admin/sections");
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
        classStream: stream?.name || klass.streamName || klass.stream || "",
        streamId: stream?._id || null,
        streamName: stream ? String(stream.name || "").trim() : "",
        streamCode: stream ? String(stream.code || "").trim() : "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
        createdBy: req.user?._id || null,
      };

      await Section.create(doc);
      req.flash?.("success", "Section created.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("CREATE SECTION ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Section already exists for that class.");
      else req.flash?.("error", "Failed to create section.");
      return res.redirect("/admin/sections");
    }
  },

  update: async (req, res) => {
    const { Section, Class, Stream } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/sections");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid section id.");
        return res.redirect("/admin/sections");
      }

      const klass = await Class.findById(req.body.classId).lean();
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect("/admin/sections");
      }

      let stream = null;
      if (req.body.streamId) {
        stream = Stream ? await Stream.findById(req.body.streamId).lean() : null;
        if (!stream) {
          req.flash?.("error", "Selected stream was not found.");
          return res.redirect("/admin/sections");
        }
        if (stream.classId && !sameId(stream.classId, klass._id)) {
          req.flash?.("error", "Selected stream does not belong to the selected class.");
          return res.redirect("/admin/sections");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, stream);
      code = slugCode(code);

      const collision = await Section.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Section code already exists.");
        return res.redirect("/admin/sections");
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
        classStream: stream?.name || klass.streamName || klass.stream || "",
        streamId: stream?._id || null,
        streamName: stream ? String(stream.name || "").trim() : "",
        streamCode: stream ? String(stream.code || "").trim() : "",
        classTeacher: req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher) ? req.body.classTeacher : null,
        room: String(req.body.room || "").trim().slice(0, 80),
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        notes: String(req.body.notes || "").trim().slice(0, 1200),
      };

      await Section.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Section updated.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("UPDATE SECTION ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Section already exists for that class.");
      else req.flash?.("error", "Failed to update section.");
      return res.redirect("/admin/sections");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Section } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid section id.");
        return res.redirect("/admin/sections");
      }
      const next = STATUSES.includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/sections");
      }
      await Section.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Section status updated.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("SET SECTION STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/sections");
    }
  },

  remove: async (req, res) => {
    try {
      const { Section } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid section id.");
        return res.redirect("/admin/sections");
      }
      await Section.deleteOne({ _id: id });
      req.flash?.("success", "Section deleted.");
      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("DELETE SECTION ERROR:", err);
      req.flash?.("error", "Failed to delete section.");
      return res.redirect("/admin/sections");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Section } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No sections selected.");
        return res.redirect("/admin/sections");
      }

      if (action === "activate") {
        await Section.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected sections activated.");
      } else if (action === "deactivate") {
        await Section.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected sections inactivated.");
      } else if (action === "archive") {
        await Section.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected sections archived.");
      } else if (action === "delete") {
        await Section.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected sections deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/sections");
    } catch (err) {
      console.error("SECTION BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/sections");
    }
  },
};
