const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

const LEVEL_TYPES = ["nursery", "primary", "secondary"];
const SHIFTS = ["day", "boarding", "both"];
const STATUSES = ["active", "inactive", "archived"];
const CLASS_LEVELS = [
  "BABY", "MIDDLE", "TOP",
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8",
  "S1", "S2", "S3", "S4", "S5", "S6",
];
const LEVEL_CLASS_MAP = {
  nursery: ["BABY", "MIDDLE", "TOP"],
  primary: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
  secondary: ["S1", "S2", "S3", "S4", "S5", "S6"],
};

function slugCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function normalizeClassLevel(value) {
  return String(value || "").trim().toUpperCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSchoolUnits(req) {
  return req.tenantDoc?.settings?.academics?.schoolUnits
    || req.tenant?.settings?.academics?.schoolUnits
    || [];
}

function findPlacement(req, schoolUnitId, campusId, levelType) {
  const schoolUnits = getSchoolUnits(req);
  for (const schoolUnit of schoolUnits) {
    if (String(schoolUnit.id || schoolUnit._id || "") !== String(schoolUnitId || "")) continue;
    for (const campus of schoolUnit.campuses || []) {
      if (String(campus.id || campus._id || "") !== String(campusId || "")) continue;
      const level = (campus.levels || []).find(
        (l) => String(l.type || "").toLowerCase() === String(levelType || "").toLowerCase()
      );
      return { schoolUnit, campus, level: level || null };
    }
  }
  return null;
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

function buildSmartCode(body, placement, sectionName, streamName) {
  const levelType = String(body.levelType || "").trim().toUpperCase();
  const classLevel = normalizeClassLevel(body.classLevel || "");
  const term = Math.max(1, Math.min(Number(body.term || 1), 3));
  const year = String(body.academicYear || "").trim();
  const campusCode = slugCode(placement?.campus?.code || placement?.campus?.name || "CAMPUS");

  const shortLevel =
    levelType === "NURSERY" ? "NRY" :
    levelType === "PRIMARY" ? "PRI" :
    levelType === "SECONDARY" ? "SEC" : "SCH";

  const sectionCode = slugCode(sectionName || "GENERAL");
  const streamCode = slugCode(streamName || "ALL");
  return slugCode(`${campusCode}-${shortLevel}-${classLevel}-${sectionCode}-${streamCode}-T${term}-${year}`);
}

const classRules = [
  body("name").trim().isLength({ min: 2, max: 180 }).withMessage("Class name is required (2-180 chars)."),
  body("schoolUnitId").trim().notEmpty().withMessage("School unit is required."),
  body("campusId").trim().notEmpty().withMessage("Campus is required."),
  body("levelType").trim().isIn(LEVEL_TYPES).withMessage("Invalid level."),
  body("classLevel").trim().isIn(CLASS_LEVELS).withMessage("Invalid class level."),
  body("sectionId").optional({ checkFalsy: true }).trim().custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Select a valid section."),
  body("streamId").optional({ checkFalsy: true }).trim().custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Select a valid stream."),
  body("code").optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 40 }).withMessage("Code must be 2-40 chars."),
  body("term").optional({ checkFalsy: true }).isInt({ min: 1, max: 3 }).toInt().withMessage("Term must be 1-3."),
  body("academicYear").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("classTeacher").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid class teacher."),
  body("shift").optional({ checkFalsy: true }).isIn(SHIFTS).withMessage("Invalid shift."),
  body("status").optional({ checkFalsy: true }).isIn(STATUSES).withMessage("Invalid status."),
  body("capacity").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("enrolledCount").optional({ checkFalsy: true }).isInt({ min: 0, max: 100000 }).toInt(),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("description").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

module.exports = {
  classRules,

  list: async (req, res) => {
    try {
      const { Class, Staff, Section, Stream } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const levelType = String(req.query.levelType || "").trim();
      const classLevel = String(req.query.classLevel || "").trim().toUpperCase();
      const academicYear = String(req.query.academicYear || "").trim();
      const term = String(req.query.term || "").trim();
      const schoolUnitId = String(req.query.schoolUnitId || "").trim();
      const campusId = String(req.query.campusId || "").trim();
      const sectionId = String(req.query.sectionId || "").trim();
      const streamId = String(req.query.streamId || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (q) {
        const rx = escapeRegExp(q);
        filter.$or = [
          { name: { $regex: rx, $options: "i" } },
          { code: { $regex: rx, $options: "i" } },
          { classLevel: { $regex: rx, $options: "i" } },
          { sectionName: { $regex: rx, $options: "i" } },
          { sectionCode: { $regex: rx, $options: "i" } },
          { streamName: { $regex: rx, $options: "i" } },
          { streamCode: { $regex: rx, $options: "i" } },
          { stream: { $regex: rx, $options: "i" } },
          { campusName: { $regex: rx, $options: "i" } },
          { room: { $regex: rx, $options: "i" } },
          { shift: { $regex: rx, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (levelType) filter.levelType = levelType;
      if (classLevel) filter.classLevel = classLevel;
      if (academicYear) filter.academicYear = academicYear;
      if (term && !Number.isNaN(Number(term))) filter.term = Number(term);
      if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
      if (campusId) filter.campusId = campusId;
      if (sectionId) filter.sectionId = sectionId;
      if (streamId) filter.streamId = streamId;

      const kpiFilter = { ...filter };
      delete kpiFilter.status;

      const [
        total,
        activeCount,
        inactiveCount,
        archivedCount,
        staffList,
        sections,
        streams,
        academicYearsRaw,
        classLevelsRaw,
      ] = await Promise.all([
        Class.countDocuments(filter),
        Class.countDocuments({ ...kpiFilter, status: "active" }),
        Class.countDocuments({ ...kpiFilter, status: "inactive" }),
        Class.countDocuments({ ...kpiFilter, status: "archived" }),
        Staff
          ? Staff.find({})
              .select("fullName name email role")
              .sort({ fullName: 1, name: 1 })
              .limit(500)
              .lean()
          : [],
        Section
          ? Section.find({})
              .select("name code schoolUnitId campusId levelType classId className classLevel classStream streamId streamName streamCode status")
              .sort({ name: 1, createdAt: -1 })
              .lean()
          : [],
        Stream
          ? Stream.find({})
              .select("name code schoolUnitId campusId levelType classId className classLevel classStream sectionId sectionName sectionCode status")
              .sort({ name: 1, createdAt: -1 })
              .lean()
          : [],
        Class.distinct("academicYear"),
        Class.distinct("classLevel"),
      ]);

      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const classes = await Class.find(filter)
        .populate("classTeacher", "fullName name email role")
        .populate("sectionId", "name code classId className")
        .populate("streamId", "name code classId className sectionId sectionName")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const academicYears = academicYearsRaw.filter(Boolean).sort();
      const classLevels = classLevelsRaw.filter(Boolean).sort();

      const kpis = {
        total,
        active: activeCount,
        inactive: inactiveCount,
        archived: archivedCount,
      };

      return res.render("tenant/classes/index", {
        tenant: req.tenant || null,
        classes,
        staffList,
        sections,
        streams,
        structure: buildStructure(req),
        academicYears,
        classLevels,
        classLevelMap: LEVEL_CLASS_MAP,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          status,
          levelType,
          classLevel,
          academicYear,
          term,
          schoolUnitId,
          campusId,
          sectionId,
          streamId,
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
    const { Class, Section, Stream } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/classes");
    }

    try {
      const placement = findPlacement(req, req.body.schoolUnitId, req.body.campusId, req.body.levelType);
      if (!placement) {
        req.flash?.("error", "Selected school unit, campus, or level was not found.");
        return res.redirect("/admin/classes");
      }

      const allowed = LEVEL_CLASS_MAP[req.body.levelType] || [];
      const normalizedClassLevel = normalizeClassLevel(req.body.classLevel);
      if (!allowed.includes(normalizedClassLevel)) {
        req.flash?.("error", "Selected class does not match the chosen level.");
        return res.redirect("/admin/classes");
      }

      let section = null;
      if (req.body.sectionId) {
        section = await Section.findById(req.body.sectionId).lean();
        if (!section) {
          req.flash?.("error", "Selected section was not found.");
          return res.redirect("/admin/classes");
        }
      }

      let stream = null;
      if (req.body.streamId) {
        stream = Stream ? await Stream.findById(req.body.streamId).lean() : null;
        if (!stream) {
          req.flash?.("error", "Selected stream was not found.");
          return res.redirect("/admin/classes");
        }
      }

      if (section && stream) {
        const classMismatch = section.classId && stream.classId && !sameId(section.classId, stream.classId);
        const sectionMismatch = stream.sectionId && !sameId(stream.sectionId, section._id);
        if (classMismatch || sectionMismatch) {
          req.flash?.("error", "Selected section and stream are not connected.");
          return res.redirect("/admin/classes");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, placement, section?.name || "", stream?.name || "");
      code = slugCode(code);

      const exists = await Class.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Class code already exists.");
        return res.redirect("/admin/classes");
      }

      const doc = {
        name,
        code,
        schoolUnitId: String(placement.schoolUnit.id || placement.schoolUnit._id || ""),
        schoolUnitName: String(placement.schoolUnit.name || "").trim(),
        schoolUnitCode: slugCode(placement.schoolUnit.code || placement.schoolUnit.name || "UNIT"),
        campusId: String(placement.campus.id || placement.campus._id || ""),
        campusName: String(placement.campus.name || "").trim(),
        campusCode: slugCode(placement.campus.code || placement.campus.name || "CAMPUS"),
        levelId: String(placement.level?.id || placement.level?._id || ""),
        levelName: String(placement.level?.name || req.body.levelType).trim(),
        levelType: LEVEL_TYPES.includes(req.body.levelType) ? req.body.levelType : "primary",
        classLevel: normalizedClassLevel,

        sectionId: section?._id || null,
        sectionName: section ? String(section.name || "").trim() : "",
        sectionCode: section ? String(section.code || "").trim() : "",
        streamId: stream?._id || null,
        streamName: stream ? String(stream.name || "").trim() : "",
        streamCode: stream ? String(stream.code || "").trim() : "",
        stream: stream ? String(stream.name || "").trim() : (section ? String(section.name || "").trim() : ""),

        term: Math.max(1, Math.min(Number(req.body.term || 1), 3)),
        academicYear: String(req.body.academicYear || "").trim().slice(0, 20),
        classTeacher:
          req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher)
            ? req.body.classTeacher
            : null,
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        room: String(req.body.room || "").trim().slice(0, 80),
        shift: SHIFTS.includes(req.body.shift) ? req.body.shift : "day",
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
        createdBy: req.user?._id || null,
      };

      await Class.create(doc);

      req.flash?.("success", "Class created.");
      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("CREATE CLASS ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Class already exists for that placement and section.");
      else req.flash?.("error", "Failed to create class.");
      return res.redirect("/admin/classes");
    }
  },

  update: async (req, res) => {
    const { Class, Section, Stream } = req.models;

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

      const placement = findPlacement(req, req.body.schoolUnitId, req.body.campusId, req.body.levelType);
      if (!placement) {
        req.flash?.("error", "Selected school unit, campus, or level was not found.");
        return res.redirect("/admin/classes");
      }

      const allowed = LEVEL_CLASS_MAP[req.body.levelType] || [];
      const normalizedClassLevel = normalizeClassLevel(req.body.classLevel);
      if (!allowed.includes(normalizedClassLevel)) {
        req.flash?.("error", "Selected class does not match the chosen level.");
        return res.redirect("/admin/classes");
      }

      let section = null;
      if (req.body.sectionId) {
        section = await Section.findById(req.body.sectionId).lean();
        if (!section) {
          req.flash?.("error", "Selected section was not found.");
          return res.redirect("/admin/classes");
        }
      }

      let stream = null;
      if (req.body.streamId) {
        stream = Stream ? await Stream.findById(req.body.streamId).lean() : null;
        if (!stream) {
          req.flash?.("error", "Selected stream was not found.");
          return res.redirect("/admin/classes");
        }
      }

      if (section && stream) {
        const classMismatch = section.classId && stream.classId && !sameId(section.classId, stream.classId);
        const sectionMismatch = stream.sectionId && !sameId(stream.sectionId, section._id);
        if (classMismatch || sectionMismatch) {
          req.flash?.("error", "Selected section and stream are not connected.");
          return res.redirect("/admin/classes");
        }
      }

      const name = String(req.body.name || "").trim();
      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, placement, section?.name || "", stream?.name || "");
      code = slugCode(code);

      const collision = await Class.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Class code already exists.");
        return res.redirect("/admin/classes");
      }

      const update = {
        name,
        code,
        schoolUnitId: String(placement.schoolUnit.id || placement.schoolUnit._id || ""),
        schoolUnitName: String(placement.schoolUnit.name || "").trim(),
        schoolUnitCode: slugCode(placement.schoolUnit.code || placement.schoolUnit.name || "UNIT"),
        campusId: String(placement.campus.id || placement.campus._id || ""),
        campusName: String(placement.campus.name || "").trim(),
        campusCode: slugCode(placement.campus.code || placement.campus.name || "CAMPUS"),
        levelId: String(placement.level?.id || placement.level?._id || ""),
        levelName: String(placement.level?.name || req.body.levelType).trim(),
        levelType: LEVEL_TYPES.includes(req.body.levelType) ? req.body.levelType : "primary",
        classLevel: normalizedClassLevel,

        sectionId: section?._id || null,
        sectionName: section ? String(section.name || "").trim() : "",
        sectionCode: section ? String(section.code || "").trim() : "",
        streamId: stream?._id || null,
        streamName: stream ? String(stream.name || "").trim() : "",
        streamCode: stream ? String(stream.code || "").trim() : "",
        stream: stream ? String(stream.name || "").trim() : (section ? String(section.name || "").trim() : ""),

        term: Math.max(1, Math.min(Number(req.body.term || 1), 3)),
        academicYear: String(req.body.academicYear || "").trim().slice(0, 20),
        classTeacher:
          req.body.classTeacher && mongoose.Types.ObjectId.isValid(req.body.classTeacher)
            ? req.body.classTeacher
            : null,
        capacity: Math.max(0, Math.min(Number(req.body.capacity || 0), 100000)),
        enrolledCount: Math.max(0, Math.min(Number(req.body.enrolledCount || 0), 100000)),
        room: String(req.body.room || "").trim().slice(0, 80),
        shift: SHIFTS.includes(req.body.shift) ? req.body.shift : "day",
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
      };

      await Class.updateOne({ _id: id }, { $set: update }, { runValidators: true });

      req.flash?.("success", "Class updated.");
      return res.redirect("/admin/classes");
    } catch (err) {
      console.error("UPDATE CLASS ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Class already exists for that placement and section.");
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

      const next = STATUSES.includes(req.body.status) ? req.body.status : null;
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
