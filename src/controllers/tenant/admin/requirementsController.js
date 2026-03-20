const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

function s(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function normalizeCode(v) {
  return s(v)
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80);
}

function toBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  const x = String(v).toLowerCase();
  return x === "true" || x === "1" || x === "on" || x === "yes";
}

function objId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || "")) ? String(v) : null;
}

function arr(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === "") return [];
  return [v];
}

function validCategory(v) {
  return ["document", "fee", "exam", "medical", "other"].includes(v) ? v : "document";
}

function parseIds(input) {
  return arr(input).map(objId).filter(Boolean);
}

const requirementRules = [
  body("title").trim().isLength({ min: 3, max: 160 }).withMessage("Title is required (3-160 chars)."),
  body("code").trim().isLength({ min: 2, max: 80 }).withMessage("Code is required (2-80 chars).")
    .customSanitizer((v) => normalizeCode(v)),
  body("category").optional({ checkFalsy: true }).custom((v) => ["document", "fee", "exam", "medical", "other"].includes(v))
    .withMessage("Invalid category."),
  body("description").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }).withMessage("Description is too long."),
  body("sortOrder").optional({ checkFalsy: true }).isInt({ min: 0, max: 99999 }).toInt(),
  body("isMandatory").optional({ checkFalsy: true }),
  body("isActive").optional({ checkFalsy: true }),
  body("appliesToAllPrograms").optional({ checkFalsy: true }),
  body("appliesToAllIntakes").optional({ checkFalsy: true })
];

module.exports = {
  requirementRules,

  index: async (req, res) => {
    try {
      const { AdmissionRequirement, Program, Intake } = req.models;

      const q = s(req.query.q);
      const category = s(req.query.category);
      const isActive = s(req.query.isActive);
      const program = s(req.query.program);
      const intake = s(req.query.intake);
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = { isDeleted: { $ne: true } };

      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { title: rx },
          { code: rx },
          { category: rx }
        ];
      }

      if (category) filter.category = validCategory(category);
      if (isActive === "true" || isActive === "false") filter.isActive = isActive === "true";

      if (program && objId(program)) {
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { appliesToAllPrograms: true },
            { programs: objId(program) }
          ]
        });
      }

      if (intake && objId(intake)) {
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { appliesToAllIntakes: true },
            { intakes: objId(intake) }
          ]
        });
      }

      const total = await AdmissionRequirement.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const [items, programs, intakes] = await Promise.all([
        AdmissionRequirement.find(filter)
          .sort({ sortOrder: 1, createdAt: -1 })
          .skip((safePage - 1) * perPage)
          .limit(perPage)
          .lean(),
        Program.find({ isDeleted: { $ne: true } }).select("name title").sort({ name: 1, title: 1 }).lean(),
        Intake.find({ isDeleted: { $ne: true } }).select("name title isActive").sort({ isActive: -1, createdAt: -1 }).lean()
      ]);

      const counts = await AdmissionRequirement.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } },
            mandatory: { $sum: { $cond: [{ $eq: ["$isMandatory", true] }, 1, 0] } },
            document: { $sum: { $cond: [{ $eq: ["$category", "document"] }, 1, 0] } },
            fee: { $sum: { $cond: [{ $eq: ["$category", "fee"] }, 1, 0] } },
            exam: { $sum: { $cond: [{ $eq: ["$category", "exam"] }, 1, 0] } },
            medical: { $sum: { $cond: [{ $eq: ["$category", "medical"] }, 1, 0] } },
            other: { $sum: { $cond: [{ $eq: ["$category", "other"] }, 1, 0] } }
          }
        }
      ]);

      return res.render("tenant/admin/requirements/index", {
        tenant: req.tenant || null,
        items,
        programs,
        intakes,
        csrfToken: res.locals.csrfToken || (typeof req.csrfToken === "function" ? req.csrfToken() : ""),
        counts: counts[0] || { total: 0, active: 0, mandatory: 0, document: 0, fee: 0, exam: 0, medical: 0, other: 0 },
        query: { q, category, isActive, program, intake, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : []
        }
      });
    } catch (err) {
      console.error("[REQ:index]", err);
      return res.status(500).send("Failed to load requirements.");
    }
  },

  create: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/admissions/requirements");
    }

    try {
      const { AdmissionRequirement } = req.models;

      const title = s(req.body.title);
      const code = normalizeCode(req.body.code);
      const category = validCategory(s(req.body.category) || "document");
      const description = s(req.body.description).slice(0, 1200);
      const sortOrder = Math.max(0, Math.min(Number(req.body.sortOrder || 0), 99999));

      const appliesToAllPrograms = toBool(req.body.appliesToAllPrograms, false);
      const appliesToAllIntakes = toBool(req.body.appliesToAllIntakes, false);
      const programs = appliesToAllPrograms ? [] : parseIds(req.body.programs);
      const intakes = appliesToAllIntakes ? [] : parseIds(req.body.intakes);
      const isMandatory = toBool(req.body.isMandatory, true);
      const isActive = toBool(req.body.isActive, true);

      const exists = await AdmissionRequirement.findOne({ code, isDeleted: { $ne: true } }).lean();
      if (exists) {
        req.flash?.("error", "Requirement code already exists.");
        return res.redirect("/admin/admissions/requirements");
      }

      await AdmissionRequirement.create({
        title,
        code,
        category,
        description,
        sortOrder,
        appliesToAllPrograms,
        programs,
        appliesToAllIntakes,
        intakes,
        isMandatory,
        isActive,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null
      });

      req.flash?.("success", "Requirement created.");
      return res.redirect("/admin/admissions/requirements");
    } catch (err) {
      console.error("[REQ:create]", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Requirement code already exists.");
      else req.flash?.("error", "Failed to create requirement.");
      return res.redirect("/admin/admissions/requirements");
    }
  },

  update: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/admissions/requirements");
    }

    try {
      const { AdmissionRequirement } = req.models;
      const id = objId(req.params.id);
      if (!id) {
        req.flash?.("error", "Invalid requirement id.");
        return res.redirect("/admin/admissions/requirements");
      }

      const item = await AdmissionRequirement.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!item) {
        req.flash?.("error", "Requirement not found.");
        return res.redirect("/admin/admissions/requirements");
      }

      const title = s(req.body.title);
      const code = normalizeCode(req.body.code);
      const category = validCategory(s(req.body.category) || item.category);
      const description = s(req.body.description).slice(0, 1200);
      const sortOrder = Math.max(0, Math.min(Number(req.body.sortOrder || item.sortOrder || 0), 99999));

      const appliesToAllPrograms = toBool(req.body.appliesToAllPrograms, false);
      const appliesToAllIntakes = toBool(req.body.appliesToAllIntakes, false);
      const programs = appliesToAllPrograms ? [] : parseIds(req.body.programs);
      const intakes = appliesToAllIntakes ? [] : parseIds(req.body.intakes);
      const isMandatory = toBool(req.body.isMandatory, item.isMandatory);
      const isActive = toBool(req.body.isActive, item.isActive);

      const collision = await AdmissionRequirement.findOne({ _id: { $ne: id }, code, isDeleted: { $ne: true } }).lean();
      if (collision) {
        req.flash?.("error", "Requirement code already exists.");
        return res.redirect("/admin/admissions/requirements");
      }

      item.title = title;
      item.code = code;
      item.category = category;
      item.description = description;
      item.sortOrder = sortOrder;
      item.appliesToAllPrograms = appliesToAllPrograms;
      item.programs = programs;
      item.appliesToAllIntakes = appliesToAllIntakes;
      item.intakes = intakes;
      item.isMandatory = isMandatory;
      item.isActive = isActive;
      item.updatedBy = req.user?._id || null;

      await item.save();

      req.flash?.("success", "Requirement updated.");
      return res.redirect("/admin/admissions/requirements");
    } catch (err) {
      console.error("[REQ:update]", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Requirement code already exists.");
      else req.flash?.("error", "Failed to update requirement.");
      return res.redirect("/admin/admissions/requirements");
    }
  },

  remove: async (req, res) => {
    try {
      const { AdmissionRequirement } = req.models;
      const id = objId(req.params.id);
      if (!id) {
        req.flash?.("error", "Invalid requirement id.");
        return res.redirect("/admin/admissions/requirements");
      }

      const item = await AdmissionRequirement.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!item) {
        req.flash?.("error", "Requirement not found.");
        return res.redirect("/admin/admissions/requirements");
      }

      if (typeof item.softDelete === "function") {
        await item.softDelete();
      } else {
        await AdmissionRequirement.updateOne({ _id: id }, { $set: { isDeleted: true, deletedAt: new Date() } });
      }

      req.flash?.("success", "Requirement deleted.");
      return res.redirect("/admin/admissions/requirements");
    } catch (err) {
      console.error("[REQ:remove]", err);
      req.flash?.("error", "Failed to delete requirement.");
      return res.redirect("/admin/admissions/requirements");
    }
  },

  bulkAction: async (req, res) => {
    try {
      const { AdmissionRequirement } = req.models;
      const action = s(req.body.action);
      const ids = s(req.body.ids)
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No requirements selected.");
        return res.redirect("/admin/admissions/requirements");
      }

      if (action === "activate") {
        await AdmissionRequirement.updateMany({ _id: { $in: ids } }, { $set: { isActive: true, updatedAt: new Date() } });
        req.flash?.("success", "Selected requirements activated.");
      } else if (action === "deactivate") {
        await AdmissionRequirement.updateMany({ _id: { $in: ids } }, { $set: { isActive: false, updatedAt: new Date() } });
        req.flash?.("success", "Selected requirements deactivated.");
      } else if (action === "delete") {
        await AdmissionRequirement.updateMany({ _id: { $in: ids } }, { $set: { isDeleted: true, deletedAt: new Date(), updatedAt: new Date() } });
        req.flash?.("success", "Selected requirements deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/admissions/requirements");
    } catch (err) {
      console.error("[REQ:bulkAction]", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/admissions/requirements");
    }
  }
};