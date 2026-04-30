const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { loadAcademicScopeLists, resolveAcademicScope } = require("../../../utils/tenantAcademicScope");
const { getSchoolUnits } = require("../../../utils/academicStructure");

const LEVEL_TYPES = ["nursery", "primary", "secondary"];
const TERMS = [1, 2, 3];
const CATEGORIES = ["core", "practical", "language", "religious", "co-curricular", "general"];
const STATUSES = ["active", "draft", "archived"];
const BASE_PATH = "/admin/subjects";
const VIEW_PATH = "tenant/subjects/index";

function slugCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
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
        type: String(level.type || "").toLowerCase(),
        code: level.code || "",
        classes: (level.classes || []).map((klass) => ({
          id: String(klass.id || klass._id || ""),
          name: klass.name || "",
          code: klass.code || "",
          classLevel: klass.classLevel || "",
          stream: klass.stream || "",
          academicYear: klass.academicYear || "",
          sections: (klass.sections || []).map((section) => ({
            id: String(section.id || section._id || ""),
            name: section.name || "",
            code: section.code || "",
          })),
        })),
      })),
    })),
  }));
}

function buildSectionsMap(req, classes) {
  const map = {};

  for (const klass of classes || []) {
    map[String(klass._id || klass.id || "")] = [];
  }

  for (const schoolUnit of getSchoolUnits(req)) {
    for (const campus of schoolUnit.campuses || []) {
      for (const level of campus.levels || []) {
        for (const klass of level.classes || []) {
          const sections = (klass.sections || []).map((section) => ({
            id: String(section.id || section._id || ""),
            name: section.name || "",
            code: section.code || "",
          }));

          const rawIds = [
            String(klass.id || ""),
            String(klass._id || ""),
          ].filter(Boolean);

          for (const rawId of rawIds) {
            map[rawId] = sections;
          }

          for (const dbClass of classes || []) {
            if (
              (rawIds.length && rawIds.includes(String(dbClass._id || ""))) ||
              (
                String(dbClass.schoolUnitId || "") === String(schoolUnit.id || schoolUnit._id || "") &&
                String(dbClass.campusId || "") === String(campus.id || campus._id || "") &&
                String(dbClass.levelType || "").toLowerCase() === String(level.type || "").toLowerCase() &&
                String(dbClass.classLevel || "").toUpperCase() === String(klass.classLevel || "").toUpperCase() &&
                String(dbClass.stream || "").toUpperCase() === String(klass.stream || "").toUpperCase()
              )
            ) {
              map[String(dbClass._id)] = sections;
            }
          }
        }
      }
    }
  }

  return map;
}

function buildSmartCode(body, klass, section, stream) {
  const campusCode = slugCode(klass?.campusCode || klass?.campusName || "CAMPUS");
  const classLevel = slugCode(klass?.classLevel || "CLASS");
  const classStream = slugCode(stream?.name || klass?.stream || "A");
  const subject = slugCode(body.title || "SUBJECT");
  const term = Math.max(1, Math.min(Number(body.term || 1), 3));
  const sectionCode = section?.code ? `-${slugCode(section.code)}` : "";
  return slugCode(`${campusCode}-${classLevel}-${classStream}${sectionCode}-${subject}-T${term}`);
}

const subjectRules = [
  body("title").trim().isLength({ min: 2, max: 180 }).withMessage("Subject name is required (2-180 chars)."),
  body("code").optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 40 }).withMessage("Code must be 2-40 chars."),
  body("classId").trim().custom((v) => mongoose.Types.ObjectId.isValid(v)).withMessage("Valid class is required."),
  body("sectionId").optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body("streamId").optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body("term").optional({ checkFalsy: true }).isInt({ min: 1, max: 3 }).toInt().withMessage("Term must be 1-3."),
  body("teacher").optional({ checkFalsy: true }).custom((v) => !v || mongoose.Types.ObjectId.isValid(v)).withMessage("Invalid teacher."),
  body("category").optional({ checkFalsy: true }).isIn(CATEGORIES).withMessage("Invalid subject category."),
  body("status").optional({ checkFalsy: true }).isIn(STATUSES).withMessage("Invalid status."),
  body("shortTitle").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("description").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
  body("objectives").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
  body("outline").optional({ checkFalsy: true }).trim().isLength({ max: 5000 }),
  body("assessmentMethod").optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
  body("passMark").optional({ checkFalsy: true }).isInt({ min: 0, max: 100 }).toInt(),
  body("weeklyPeriods").optional({ checkFalsy: true }).isInt({ min: 0, max: 50 }).toInt(),
];

module.exports = {
  subjectRules,

  list: async (req, res) => {
    try {
      const { Subject, Staff, Class } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const category = String(req.query.category || "").trim();
      const levelType = String(req.query.levelType || "").trim().toLowerCase();
      const classId = String(req.query.classId || "").trim();
      const sectionId = String(req.query.sectionId || "").trim();
      const streamId = String(req.query.streamId || "").trim();
      const term = String(req.query.term || "").trim();
      const schoolUnitId = String(req.query.schoolUnitId || "").trim();
      const campusId = String(req.query.campusId || "").trim();
      const academicYear = String(req.query.academicYear || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { shortTitle: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
          { className: { $regex: q, $options: "i" } },
          { classLevel: { $regex: q, $options: "i" } },
          { sectionName: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
        ];
      }

      if (status) filter.status = status;
      if (category) filter.category = category;
      if (LEVEL_TYPES.includes(levelType)) filter.levelType = levelType;
      if (classId && mongoose.Types.ObjectId.isValid(classId)) filter.classId = classId;
      if (sectionId) filter.sectionId = sectionId;
      if (streamId) filter.streamId = streamId;
      if (schoolUnitId) filter.schoolUnitId = schoolUnitId;
      if (campusId) filter.campusId = campusId;
      if (academicYear) filter.academicYear = academicYear;
      if (term && !Number.isNaN(Number(term))) filter.term = Number(term);

      const total = await Subject.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const classes = Class
        ? await Class.find({})
            .select("name code schoolUnitId schoolUnitName campusId campusName campusCode levelType classLevel stream academicYear term")
            .sort({ createdAt: -1 })
            .lean()
        : [];

      const subjects = await Subject.find(filter)
        .populate("teacher", "fullName name email role")
        .populate("classId", "name code classLevel stream academicYear term campusName levelType")
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const staffList = Staff
        ? await Staff.find({})
            .select("fullName name role email")
            .sort({ fullName: 1, name: 1 })
            .lean()
        : [];

      const scopeLists = await loadAcademicScopeLists(req);
      const academicYears = (await Subject.distinct("academicYear")).filter(Boolean).sort();

      const kpis = {
        total,
        active: await Subject.countDocuments({ ...filter, status: "active" }),
        draft: await Subject.countDocuments({ ...filter, status: "draft" }),
        archived: await Subject.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render(VIEW_PATH, {
        tenant: req.tenant || null,
        subjects,
        classes,
        sections: scopeLists.sections,
        streams: scopeLists.streams,
        staffList,
        structure: buildStructure(req),
        sectionsMap: Object.fromEntries(scopeLists.classes.map((c) => [String(c._id), scopeLists.sections.filter((s) => String(s.classId) === String(c._id))])),
        academicYears,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q, status, category, levelType, classId, sectionId, streamId, term, schoolUnitId, campusId, academicYear,
          page: safePage, total, totalPages, perPage,
        },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("SUBJECTS LIST ERROR:", err);
      return res.status(500).send("Failed to load subjects.");
    }
  },

  create: async (req, res) => {
    const { Subject, Class } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect(BASE_PATH);
    }

    try {
      const scope = await resolveAcademicScope(req, {
        classId: req.body.classId,
        sectionId: req.body.sectionId,
        streamId: req.body.streamId,
      });
      if (scope.errors.length) {
        req.flash?.("error", scope.errors.join(" "));
        return res.redirect(BASE_PATH);
      }

      const klass = scope.classDoc;
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect(BASE_PATH);
      }

      const section = scope.sectionDoc || null;
      const stream = scope.streamDoc || null;

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, section, stream);
      code = slugCode(code);

      const exists = await Subject.findOne({ code }).lean();
      if (exists) {
        req.flash?.("error", "Subject code already exists.");
        return res.redirect(BASE_PATH);
      }

      const doc = {
        title: String(req.body.title || "").trim().slice(0, 180),
        code,
        shortTitle: String(req.body.shortTitle || "").trim().slice(0, 80),
        schoolUnitId: klass.schoolUnitId || "",
        schoolUnitName: klass.schoolUnitName || "",
        schoolUnitCode: slugCode(klass.schoolUnitCode || klass.schoolUnitName || "UNIT"),
        campusId: klass.campusId || "",
        campusName: klass.campusName || "",
        campusCode: slugCode(klass.campusCode || klass.campusName || "CAMPUS"),
        levelType: LEVEL_TYPES.includes(String(klass.levelType || "").toLowerCase()) ? String(klass.levelType).toLowerCase() : "primary",
        classId: klass._id,
        className: klass.name || "",
        classCode: klass.code || "",
        classLevel: klass.classLevel || "",
        classStream: stream?.name || klass.stream || "",
        sectionId: section?._id || "",
        sectionName: section?.name || "",
        sectionCode: section?.code || "",
        streamId: stream?._id || "",
        streamName: stream?.name || "",
        streamCode: stream?.code || "",
        term: TERMS.includes(Number(req.body.term)) ? Number(req.body.term) : 1,
        academicYear: String(req.body.academicYear || klass.academicYear || "").trim().slice(0, 20),
        category: CATEGORIES.includes(req.body.category) ? req.body.category : "core",
        isCompulsory: String(req.body.isCompulsory) === "true" || String(req.body.isCompulsory) === "on",
        weeklyPeriods: Math.max(0, Math.min(Number(req.body.weeklyPeriods || 0), 50)),
        passMark: Math.max(0, Math.min(Number(req.body.passMark || 0), 100)),
        assessmentMethod: String(req.body.assessmentMethod || "").trim().slice(0, 500),
        teacher: req.body.teacher && mongoose.Types.ObjectId.isValid(req.body.teacher) ? req.body.teacher : null,
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
        objectives: String(req.body.objectives || "").trim().slice(0, 1200),
        outline: String(req.body.outline || "").trim().slice(0, 5000),
        createdBy: req.user?._id || null,
      };

      await Subject.create(doc);
      req.flash?.("success", "Subject created.");
      return res.redirect(BASE_PATH);
    } catch (err) {
      console.error("CREATE SUBJECT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Subject code already exists.");
      else req.flash?.("error", "Failed to create subject.");
      return res.redirect(BASE_PATH);
    }
  },

  update: async (req, res) => {
    const { Subject, Class } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect(BASE_PATH);
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid subject id.");
        return res.redirect(BASE_PATH);
      }

      const scope = await resolveAcademicScope(req, {
        classId: req.body.classId,
        sectionId: req.body.sectionId,
        streamId: req.body.streamId,
      });
      if (scope.errors.length) {
        req.flash?.("error", scope.errors.join(" "));
        return res.redirect(BASE_PATH);
      }

      const klass = scope.classDoc;
      if (!klass) {
        req.flash?.("error", "Selected class was not found.");
        return res.redirect(BASE_PATH);
      }

      const section = scope.sectionDoc || null;
      const stream = scope.streamDoc || null;

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = buildSmartCode(req.body, klass, section, stream);
      code = slugCode(code);

      const collision = await Subject.findOne({ code, _id: { $ne: id } }).lean();
      if (collision) {
        req.flash?.("error", "Subject code already exists.");
        return res.redirect(BASE_PATH);
      }

      const update = {
        title: String(req.body.title || "").trim().slice(0, 180),
        code,
        shortTitle: String(req.body.shortTitle || "").trim().slice(0, 80),
        schoolUnitId: klass.schoolUnitId || "",
        schoolUnitName: klass.schoolUnitName || "",
        schoolUnitCode: slugCode(klass.schoolUnitCode || klass.schoolUnitName || "UNIT"),
        campusId: klass.campusId || "",
        campusName: klass.campusName || "",
        campusCode: slugCode(klass.campusCode || klass.campusName || "CAMPUS"),
        levelType: LEVEL_TYPES.includes(String(klass.levelType || "").toLowerCase()) ? String(klass.levelType).toLowerCase() : "primary",
        classId: klass._id,
        className: klass.name || "",
        classCode: klass.code || "",
        classLevel: klass.classLevel || "",
        classStream: stream?.name || klass.stream || "",
        sectionId: section?._id || "",
        sectionName: section?.name || "",
        sectionCode: section?.code || "",
        streamId: stream?._id || "",
        streamName: stream?.name || "",
        streamCode: stream?.code || "",
        term: TERMS.includes(Number(req.body.term)) ? Number(req.body.term) : 1,
        academicYear: String(req.body.academicYear || klass.academicYear || "").trim().slice(0, 20),
        category: CATEGORIES.includes(req.body.category) ? req.body.category : "core",
        isCompulsory: String(req.body.isCompulsory) === "true" || String(req.body.isCompulsory) === "on",
        weeklyPeriods: Math.max(0, Math.min(Number(req.body.weeklyPeriods || 0), 50)),
        passMark: Math.max(0, Math.min(Number(req.body.passMark || 0), 100)),
        assessmentMethod: String(req.body.assessmentMethod || "").trim().slice(0, 500),
        teacher: req.body.teacher && mongoose.Types.ObjectId.isValid(req.body.teacher) ? req.body.teacher : null,
        status: STATUSES.includes(req.body.status) ? req.body.status : "active",
        description: String(req.body.description || "").trim().slice(0, 1200),
        objectives: String(req.body.objectives || "").trim().slice(0, 1200),
        outline: String(req.body.outline || "").trim().slice(0, 5000),
      };

      await Subject.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Subject updated.");
      return res.redirect(BASE_PATH);
    } catch (err) {
      console.error("UPDATE SUBJECT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Subject code already exists.");
      else req.flash?.("error", "Failed to update subject.");
      return res.redirect(BASE_PATH);
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Subject } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid subject id.");
        return res.redirect(BASE_PATH);
      }

      const next = STATUSES.includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect(BASE_PATH);
      }

      await Subject.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Subject status updated.");
      return res.redirect(BASE_PATH);
    } catch (err) {
      console.error("SET SUBJECT STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect(BASE_PATH);
    }
  },

  remove: async (req, res) => {
    try {
      const { Subject } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid subject id.");
        return res.redirect(BASE_PATH);
      }

      await Subject.deleteOne({ _id: id });
      req.flash?.("success", "Subject deleted.");
      return res.redirect(BASE_PATH);
    } catch (err) {
      console.error("DELETE SUBJECT ERROR:", err);
      req.flash?.("error", "Failed to delete subject.");
      return res.redirect(BASE_PATH);
    }
  },

  bulk: async (req, res) => {
    try {
      const { Subject } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No subjects selected.");
        return res.redirect(BASE_PATH);
      }

      if (action === "activate") {
        await Subject.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected subjects activated.");
      } else if (action === "draft") {
        await Subject.updateMany({ _id: { $in: ids } }, { $set: { status: "draft" } });
        req.flash?.("success", "Selected subjects set to draft.");
      } else if (action === "archive") {
        await Subject.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected subjects archived.");
      } else if (action === "delete") {
        await Subject.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected subjects deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect(BASE_PATH);
    } catch (err) {
      console.error("SUBJECT BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect(BASE_PATH);
    }
  },
};
