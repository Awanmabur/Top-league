const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { getSchoolUnits } = require("../../../utils/academicStructure");

function safeText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function slugCode(input, max = 60) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, max);
}

function safeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function readTenantAcademicState(req) {
  const academics = req?.tenant?.settings?.academics || {};
  const schoolUnits = getSchoolUnits(req);
  return {
    academics,
    schoolUnits,
  };
}

function normalizeSection(section) {
  const name = safeText(typeof section === "string" ? section : section?.name, 80);
  if (!name) return null;
  return {
    name,
    code: safeLower(section?.code || name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50),
    isActive: section?.isActive !== false,
  };
}

function normalizeSections(rawSections) {
  const list = Array.isArray(rawSections) ? rawSections : rawSections ? [rawSections] : [];
  const seen = new Set();
  return list
    .map(normalizeSection)
    .filter(Boolean)
    .filter((item) => {
      const key = safeLower(item.code || item.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildDefaultSections(levelName, schoolUnitCategory) {
  const upper = String(levelName || "").trim().toUpperCase();
  if (!upper) return [];

  if (["BABY", "MIDDLE", "TOP"].includes(upper)) {
    return ["RED", "BLUE"].map((name) => ({ name, code: safeLower(name), isActive: true }));
  }

  if (upper.startsWith("P")) {
    return ["A", "B"].map((name) => ({ name, code: safeLower(name), isActive: true }));
  }

  if (upper.startsWith("S")) {
    return ["A", "B"].map((name) => ({ name, code: safeLower(name), isActive: true }));
  }

  if (safeLower(schoolUnitCategory) === "nursery") {
    return ["RED", "BLUE"].map((name) => ({ name, code: safeLower(name), isActive: true }));
  }

  return [];
}

function flattenLevels(structure) {
  const rows = [];
  structure.forEach((unit) => {
    (unit.campuses || []).forEach((campus) => {
      (campus.levels || []).forEach((level) => {
        rows.push({
          id: `${unit.code}::${campus.code}::${level.code}`,
          schoolUnitCode: unit.code,
          schoolUnitName: unit.name,
          schoolUnitCategory: unit.category || "mixed",
          campusCode: campus.code,
          campusName: campus.name,
          levelCode: level.code,
          levelName: level.name,
          status: level.isActive === false ? "inactive" : "active",
          sectionCount: Array.isArray(level.sections) ? level.sections.length : 0,
          sections: Array.isArray(level.sections) ? level.sections : [],
          profile: level.profile || {},
        });
      });
    });
  });
  return rows;
}

function readStructure(req) {
  const { schoolUnits } = readTenantAcademicState(req);
  return schoolUnits
    .map((unit) => {
      const schoolUnitCode = safeLower(unit?.code || unit?.name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const schoolUnitName = safeText(unit?.name, 160);
      const category = safeLower(unit?.category || "mixed");
      const campuses = (Array.isArray(unit?.campuses) ? unit.campuses : [])
        .map((campus) => {
          const campusCode = safeLower(campus?.code || campus?.name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
          const campusName = safeText(campus?.name, 160);
          const levels = (Array.isArray(campus?.levels) ? campus.levels : [])
            .map((level) => {
              const levelCode = safeLower(level?.code || level?.name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
              const levelName = safeText(level?.name, 120);
              if (!levelCode || !levelName) return null;
              return {
                name: levelName,
                code: levelCode,
                isActive: level?.isActive !== false,
                profile: level?.profile || {},
                sections: normalizeSections(level?.sections),
              };
            })
            .filter(Boolean);

          if (!campusCode || !campusName) return null;
          return {
            name: campusName,
            code: campusCode,
            isMain: campus?.isMain === true,
            levels,
          };
        })
        .filter(Boolean);

      if (!schoolUnitCode || !schoolUnitName) return null;
      return {
        name: schoolUnitName,
        code: schoolUnitCode,
        category,
        campuses,
      };
    })
    .filter(Boolean);
}

function findPlacement(structure, body) {
  const schoolUnitCode = safeLower(body.schoolUnitCode || body.schoolUnit);
  const campusCode = safeLower(body.campusCode || body.campus);
  const schoolUnit = structure.find((item) => item.code === schoolUnitCode);
  if (!schoolUnit) throw new Error("Selected school unit was not found in tenant structure.");
  const campus = (schoolUnit.campuses || []).find((item) => item.code === campusCode);
  if (!campus) throw new Error("Selected location was not found under the chosen school unit.");
  return { schoolUnit, campus };
}

function levelRules() {
  return [
    body("name").trim().isLength({ min: 1, max: 80 }).withMessage("Level name is required."),
    body("code").optional({ checkFalsy: true }).trim().isLength({ max: 50 }).withMessage("Level code is too long."),
    body("schoolUnitCode").trim().notEmpty().withMessage("School unit is required."),
    body("campusCode").trim().notEmpty().withMessage("Location is required."),
    body("status").optional({ checkFalsy: true }).isIn(["active", "inactive"]).withMessage("Invalid level status."),
    body("title").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
    body("description").optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
    body("curriculum").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
    body("admissionsNote").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
    body("feesNote").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
    body("sectionsText").optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  ];
}

async function getPlatformTenantModel(req) {
  if (req?.platformModels?.Tenant) return req.platformModels.Tenant;
  if (req?.app?.locals?.platformModels?.Tenant) return req.app.locals.platformModels.Tenant;
  try {
    const { platformConnection } = require("../../config/db");
    return require("../../models/platform/Tenant")(platformConnection);
  } catch (_) {
    try {
      const { platformConnection } = require("../config/db");
      return require("../models/platform/Tenant")(platformConnection);
    } catch (err) {
      throw new Error("Platform Tenant model is not available for level updates.");
    }
  }
}

async function saveAcademicStructure(req, nextSchoolUnits) {
  const Tenant = await getPlatformTenantModel(req);
  const tenantId = req?.tenant?._id || req?.tenant?.id;
  if (!tenantId) throw new Error("Current tenant id is missing.");

  const tenantDoc = await Tenant.findById(tenantId);
  if (!tenantDoc) throw new Error("Current tenant record was not found.");

  tenantDoc.settings = tenantDoc.settings || {};
  tenantDoc.settings.academics = tenantDoc.settings.academics || {};
  tenantDoc.settings.academics.schoolUnits = nextSchoolUnits;

  const campuses = [];
  const levels = new Set();
  const sections = new Set();

  nextSchoolUnits.forEach((unit) => {
    (unit.campuses || []).forEach((campus) => {
      campuses.push(campus);
      (campus.levels || []).forEach((level) => {
        if (level.name) levels.add(level.name);
        (level.sections || []).forEach((section) => {
          if (section.name) sections.add(section.name);
        });
      });
    });
  });

  tenantDoc.settings.academics.campuses = campuses;
  tenantDoc.settings.academics.educationLevels = Array.from(levels);
  tenantDoc.settings.academics.schoolSections = Array.from(sections);
  tenantDoc.settings.academics.hasMultipleCampuses = campuses.length > 1;
  tenantDoc.updatedBy = req.user?._id || tenantDoc.updatedBy || null;
  await tenantDoc.save();
  return tenantDoc;
}

function parseSectionsText(text, levelName, schoolUnitCategory) {
  const raw = String(text || "").trim();
  if (!raw) return buildDefaultSections(levelName, schoolUnitCategory);
  const parts = raw
    .split(/[,\n|]+/)
    .map((item) => safeText(item, 80))
    .filter(Boolean);
  const normalized = normalizeSections(parts.map((name) => ({ name })));
  return normalized.length ? normalized : buildDefaultSections(levelName, schoolUnitCategory);
}

function findLevelIndexes(schoolUnits, schoolUnitCode, campusCode, levelCode) {
  let unitIndex = -1;
  let campusIndex = -1;
  let levelIndex = -1;

  schoolUnits.some((unit, uIdx) => {
    if (safeLower(unit.code || unit.name) !== safeLower(schoolUnitCode)) return false;
    unitIndex = uIdx;
    (unit.campuses || []).some((campus, cIdx) => {
      if (safeLower(campus.code || campus.name) !== safeLower(campusCode)) return false;
      campusIndex = cIdx;
      levelIndex = (campus.levels || []).findIndex((level) => safeLower(level.code || level.name) === safeLower(levelCode));
      return levelIndex >= 0;
    });
    return campusIndex >= 0;
  });

  return { unitIndex, campusIndex, levelIndex };
}

module.exports = {
  levelRules: levelRules(),

  list: async (req, res) => {
    try {
      const structure = readStructure(req);
      const q = safeText(req.query.q, 120);
      const schoolUnitCode = safeLower(req.query.schoolUnitCode);
      const campusCode = safeLower(req.query.campusCode);
      const status = safeLower(req.query.status);
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      let rows = flattenLevels(structure);
      if (q) {
        const ql = q.toLowerCase();
        rows = rows.filter((item) =>
          [item.levelName, item.levelCode, item.campusName, item.schoolUnitName]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(ql))
        );
      }
      if (schoolUnitCode) rows = rows.filter((item) => item.schoolUnitCode === schoolUnitCode);
      if (campusCode) rows = rows.filter((item) => item.campusCode === campusCode);
      if (status) rows = rows.filter((item) => item.status === status);

      rows.sort((a, b) => {
        const ua = `${a.schoolUnitName} ${a.campusName} ${a.levelName}`.toLowerCase();
        const ub = `${b.schoolUnitName} ${b.campusName} ${b.levelName}`.toLowerCase();
        return ua.localeCompare(ub);
      });

      const total = rows.length;
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);
      const levels = rows.slice((safePage - 1) * perPage, safePage * perPage);

      const schoolUnitOptions = structure.map((unit) => ({ code: unit.code, name: unit.name }));
      const campusOptions = structure.flatMap((unit) =>
        (unit.campuses || []).map((campus) => ({ schoolUnitCode: unit.code, schoolUnitName: unit.name, campusCode: campus.code, campusName: campus.name }))
      );

      const kpis = {
        total,
        active: rows.filter((item) => item.status === "active").length,
        inactive: rows.filter((item) => item.status === "inactive").length,
        sections: rows.reduce((sum, item) => sum + (item.sectionCount || 0), 0),
      };

      return res.render("tenant/levels/index", {
        tenant: req.tenant || null,
        levels,
        structure,
        schoolUnitOptions,
        campusOptions,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          schoolUnitCode,
          campusCode,
          status,
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
      console.error("LEVELS LIST ERROR:", err);
      return res.status(500).send("Failed to load levels.");
    }
  },

  create: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/levels");
    }

    try {
      const structure = readStructure(req);
      const { schoolUnit, campus } = findPlacement(structure, req.body);
      const schoolUnits = readTenantAcademicState(req).schoolUnits;
      const unitIndex = schoolUnits.findIndex((item) => safeLower(item.code || item.name) === schoolUnit.code);
      if (unitIndex < 0) throw new Error("School unit could not be loaded for update.");
      const campusIndex = (schoolUnits[unitIndex].campuses || []).findIndex((item) => safeLower(item.code || item.name) === campus.code);
      if (campusIndex < 0) throw new Error("Location could not be loaded for update.");

      const levelName = safeText(req.body.name, 80);
      const levelCode = safeLower(req.body.code || req.body.name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);
      const levels = Array.isArray(schoolUnits[unitIndex].campuses[campusIndex].levels) ? schoolUnits[unitIndex].campuses[campusIndex].levels : [];

      if (levels.some((item) => safeLower(item.code || item.name) === levelCode || safeLower(item.name) === safeLower(levelName))) {
        req.flash?.("error", "A level with the same name or code already exists in this location.");
        return res.redirect("/admin/levels");
      }

      levels.push({
        name: levelName,
        code: levelCode,
        isActive: safeLower(req.body.status || "active") !== "inactive",
        profile: {
          title: safeText(req.body.title, 120),
          description: safeText(req.body.description, 2000),
          curriculum: safeText(req.body.curriculum, 120),
          admissionsNote: safeText(req.body.admissionsNote, 1200),
          feesNote: safeText(req.body.feesNote, 1200),
        },
        sections: parseSectionsText(req.body.sectionsText, levelName, schoolUnit.category),
      });

      schoolUnits[unitIndex].campuses[campusIndex].levels = levels;
      await saveAcademicStructure(req, schoolUnits);
      req.flash?.("success", "Level created.");
      return res.redirect("/admin/levels");
    } catch (err) {
      console.error("CREATE LEVEL ERROR:", err);
      req.flash?.("error", err?.message || "Failed to create level.");
      return res.redirect("/admin/levels");
    }
  },

  update: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/levels");
    }

    try {
      const currentUnitCode = safeLower(req.params.schoolUnitCode);
      const currentCampusCode = safeLower(req.params.campusCode);
      const currentLevelCode = safeLower(req.params.levelCode);
      const schoolUnits = readTenantAcademicState(req).schoolUnits;
      const { unitIndex, campusIndex, levelIndex } = findLevelIndexes(schoolUnits, currentUnitCode, currentCampusCode, currentLevelCode);
      if (unitIndex < 0 || campusIndex < 0 || levelIndex < 0) throw new Error("Level not found.");

      const structure = readStructure(req);
      const { schoolUnit, campus } = findPlacement(structure, req.body);
      const nextLevelName = safeText(req.body.name, 80);
      const nextLevelCode = safeLower(req.body.code || req.body.name).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);

      const targetUnitIndex = schoolUnits.findIndex((item) => safeLower(item.code || item.name) === schoolUnit.code);
      const targetCampusIndex = (schoolUnits[targetUnitIndex]?.campuses || []).findIndex((item) => safeLower(item.code || item.name) === campus.code);
      if (targetUnitIndex < 0 || targetCampusIndex < 0) throw new Error("Target location was not found.");

      const movingLevel = schoolUnits[unitIndex].campuses[campusIndex].levels[levelIndex];
      const nextSections = parseSectionsText(req.body.sectionsText, nextLevelName, schoolUnit.category);
      const nextLevel = {
        ...movingLevel,
        name: nextLevelName,
        code: nextLevelCode,
        isActive: safeLower(req.body.status || "active") !== "inactive",
        profile: {
          title: safeText(req.body.title, 120),
          description: safeText(req.body.description, 2000),
          curriculum: safeText(req.body.curriculum, 120),
          admissionsNote: safeText(req.body.admissionsNote, 1200),
          feesNote: safeText(req.body.feesNote, 1200),
        },
        sections: nextSections,
      };

      const targetLevels = Array.isArray(schoolUnits[targetUnitIndex].campuses[targetCampusIndex].levels) ? schoolUnits[targetUnitIndex].campuses[targetCampusIndex].levels : [];
      const collision = targetLevels.some((item, idx) => {
        const sameSlot = targetUnitIndex === unitIndex && targetCampusIndex === campusIndex && idx === levelIndex;
        if (sameSlot) return false;
        return safeLower(item.code || item.name) === nextLevelCode || safeLower(item.name) === safeLower(nextLevelName);
      });
      if (collision) {
        req.flash?.("error", "A level with the same name or code already exists in the selected location.");
        return res.redirect("/admin/levels");
      }

      schoolUnits[unitIndex].campuses[campusIndex].levels.splice(levelIndex, 1);
      schoolUnits[targetUnitIndex].campuses[targetCampusIndex].levels.push(nextLevel);

      await saveAcademicStructure(req, schoolUnits);
      req.flash?.("success", "Level updated.");
      return res.redirect("/admin/levels");
    } catch (err) {
      console.error("UPDATE LEVEL ERROR:", err);
      req.flash?.("error", err?.message || "Failed to update level.");
      return res.redirect("/admin/levels");
    }
  },

  setStatus: async (req, res) => {
    try {
      const schoolUnits = readTenantAcademicState(req).schoolUnits;
      const { unitIndex, campusIndex, levelIndex } = findLevelIndexes(
        schoolUnits,
        req.params.schoolUnitCode,
        req.params.campusCode,
        req.params.levelCode
      );
      if (unitIndex < 0 || campusIndex < 0 || levelIndex < 0) throw new Error("Level not found.");

      const nextStatus = safeLower(req.body.status);
      if (!["active", "inactive"].includes(nextStatus)) throw new Error("Invalid level status.");

      schoolUnits[unitIndex].campuses[campusIndex].levels[levelIndex].isActive = nextStatus === "active";
      await saveAcademicStructure(req, schoolUnits);
      req.flash?.("success", "Level status updated.");
      return res.redirect("/admin/levels");
    } catch (err) {
      console.error("SET LEVEL STATUS ERROR:", err);
      req.flash?.("error", err?.message || "Failed to update level status.");
      return res.redirect("/admin/levels");
    }
  },

  remove: async (req, res) => {
    try {
      const schoolUnits = readTenantAcademicState(req).schoolUnits;
      const { unitIndex, campusIndex, levelIndex } = findLevelIndexes(
        schoolUnits,
        req.params.schoolUnitCode,
        req.params.campusCode,
        req.params.levelCode
      );
      if (unitIndex < 0 || campusIndex < 0 || levelIndex < 0) throw new Error("Level not found.");

      schoolUnits[unitIndex].campuses[campusIndex].levels.splice(levelIndex, 1);
      await saveAcademicStructure(req, schoolUnits);
      req.flash?.("success", "Level deleted.");
      return res.redirect("/admin/levels");
    } catch (err) {
      console.error("DELETE LEVEL ERROR:", err);
      req.flash?.("error", err?.message || "Failed to delete level.");
      return res.redirect("/admin/levels");
    }
  },
};

