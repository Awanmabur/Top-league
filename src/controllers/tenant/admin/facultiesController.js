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

function escapeRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanObjectIds(v, max = 200) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const out = [];
  const seen = new Set();

  for (const raw of arr) {
    const s = String(raw || "").trim();
    if (!mongoose.Types.ObjectId.isValid(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(new mongoose.Types.ObjectId(s));
    if (out.length >= max) break;
  }
  return out;
}

function splitCsvList(v, max = 200) {
  return String(v || "")
    .split(/[|,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

async function buildLabelsFromIds(req, ids, modelName, pickLabel) {
  try {
    const M = req.models?.[modelName];
    if (!M || !ids?.length) return [];
    const docs = await M.find({ _id: { $in: ids } }).select("_id name title code").lean();

    const labels = docs
      .map((d) => pickLabel(d))
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    return [...new Set(labels)];
  } catch {
    return [];
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];

    if (inQuotes) {
      if (c === '"' && n === '"') {
        value += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        value += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(value);
        value = "";
      } else if (c === "\n") {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else if (c === "\r") {
        // ignore
      } else {
        value += c;
      }
    }
  }

  row.push(value);
  if (row.some((x) => String(x).length > 0)) rows.push(row);
  return rows;
}

const facultyRules = [
  body("name").trim().isLength({ min: 2, max: 160 }).withMessage("Name is required (2-160 chars)."),

  body("code")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 30 })
    .withMessage("Code must be 2-30 chars.")
    .customSanitizer((v) => String(v || "").toUpperCase()),

  body("status")
    .optional({ checkFalsy: true })
    .isIn(["active", "inactive"])
    .withMessage("Invalid status."),

  body("publicEmail").optional({ checkFalsy: true }).isEmail().withMessage("Invalid email."),
  body("phone").optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body("officeLocation").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("description").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),

  body("dean")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(String(v)))
    .withMessage("Invalid dean id."),

  body("departments").optional({ checkFalsy: true }),
  body("programs").optional({ checkFalsy: true }),
  body("courses").optional({ checkFalsy: true }),
];

module.exports = {
  facultyRules,

  list: async (req, res) => {
    try {
      const { Faculty, Staff } = req.models;

      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};

      if (q) {
        const safe = escapeRegex(q);
        filter.$or = [
          { name: { $regex: safe, $options: "i" } },
          { code: { $regex: safe, $options: "i" } },
          { publicEmail: { $regex: safe, $options: "i" } },
          { officeLocation: { $regex: safe, $options: "i" } },
        ];
      }

      if (status) filter.status = status;

      const total = await Faculty.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const faculties = await Faculty.find(filter)
        .populate({ path: "dean", select: "fullName name email role", model: Staff })
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

      const linkedDepartments = faculties.reduce((sum, f) => sum + (Array.isArray(f.departmentLabels) ? f.departmentLabels.length : 0), 0);

      const kpis = {
        total,
        active: await Faculty.countDocuments({ ...filter, status: "active" }),
        inactive: await Faculty.countDocuments({ ...filter, status: "inactive" }),
        linkedDepartments,
      };

      return res.render("tenant/admin/faculties/index", {
        tenant: req.tenant || null,
        faculties,
        staffList,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
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
      console.error("FACULTIES LIST ERROR:", err);
      return res.status(500).send("Failed to load faculties.");
    }
  },

  create: async (req, res) => {
    const { Faculty } = req.models;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/faculties");
    }

    try {
      const name = String(req.body.name || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = slugCode(name);
      code = slugCode(code);

      const exists = await Faculty.findOne({ code }).select("_id").lean();
      if (exists) {
        req.flash?.("error", "Faculty code already exists.");
        return res.redirect("/admin/faculties");
      }

      const dean = req.body.dean && mongoose.Types.ObjectId.isValid(req.body.dean)
        ? req.body.dean
        : null;

      const departments = cleanObjectIds(req.body["departments[]"] ?? req.body.departments);
      const programs = cleanObjectIds(req.body["programs[]"] ?? req.body.programs);
      const courses = cleanObjectIds(req.body["courses[]"] ?? req.body.courses);

      const departmentLabels = await buildLabelsFromIds(req, departments, "Department", (d) => d.name || d.title || d.code);
      const programLabels = await buildLabelsFromIds(req, programs, "Program", (p) => p.title || p.name || p.code);
      const courseLabels = await buildLabelsFromIds(req, courses, "Course", (c) => c.title || c.name || c.code);

      await Faculty.create({
        name,
        code,
        status: ["active", "inactive"].includes(req.body.status) ? req.body.status : "active",
        publicEmail: String(req.body.publicEmail || "").trim(),
        phone: String(req.body.phone || "").trim(),
        officeLocation: String(req.body.officeLocation || "").trim(),
        description: String(req.body.description || "").trim().slice(0, 1200),
        dean,
        departments,
        programs,
        courses,
        departmentLabels,
        programLabels,
        courseLabels,
        createdBy: req.user?._id || null,
      });

      req.flash?.("success", "Faculty created.");
      return res.redirect("/admin/faculties");
    } catch (err) {
      console.error("CREATE FACULTY ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Faculty code already exists.");
      else req.flash?.("error", "Failed to create faculty.");
      return res.redirect("/admin/faculties");
    }
  },

  update: async (req, res) => {
    const { Faculty } = req.models;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/faculties");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid faculty id.");
        return res.redirect("/admin/faculties");
      }

      const name = String(req.body.name || "").trim();

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) code = slugCode(name);
      code = slugCode(code);

      const collision = await Faculty.findOne({ code, _id: { $ne: id } }).select("_id").lean();
      if (collision) {
        req.flash?.("error", "Faculty code already exists.");
        return res.redirect("/admin/faculties");
      }

      const departments = cleanObjectIds(req.body["departments[]"] ?? req.body.departments);
      const programs = cleanObjectIds(req.body["programs[]"] ?? req.body.programs);
      const courses = cleanObjectIds(req.body["courses[]"] ?? req.body.courses);

      const departmentLabels = await buildLabelsFromIds(req, departments, "Department", (d) => d.name || d.title || d.code);
      const programLabels = await buildLabelsFromIds(req, programs, "Program", (p) => p.title || p.name || p.code);
      const courseLabels = await buildLabelsFromIds(req, courses, "Course", (c) => c.title || c.name || c.code);

      await Faculty.updateOne(
        { _id: id },
        {
          $set: {
            name,
            code,
            status: ["active", "inactive"].includes(req.body.status) ? req.body.status : "active",
            publicEmail: String(req.body.publicEmail || "").trim(),
            phone: String(req.body.phone || "").trim(),
            officeLocation: String(req.body.officeLocation || "").trim(),
            description: String(req.body.description || "").trim().slice(0, 1200),
            dean: req.body.dean && mongoose.Types.ObjectId.isValid(req.body.dean) ? req.body.dean : null,
            departments,
            programs,
            courses,
            departmentLabels,
            programLabels,
            courseLabels,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Faculty updated.");
      return res.redirect("/admin/faculties");
    } catch (err) {
      console.error("UPDATE FACULTY ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Faculty code already exists.");
      else req.flash?.("error", "Failed to update faculty.");
      return res.redirect("/admin/faculties");
    }
  },

  toggleStatus: async (req, res) => {
    try {
      const { Faculty } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid faculty id.");
        return res.redirect("/admin/faculties");
      }

      const next = ["active", "inactive"].includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/faculties");
      }

      await Faculty.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Faculty status updated.");
      return res.redirect("/admin/faculties");
    } catch (err) {
      console.error("TOGGLE FACULTY STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/faculties");
    }
  },

  remove: async (req, res) => {
    try {
      const { Faculty } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid faculty id.");
        return res.redirect("/admin/faculties");
      }

      await Faculty.deleteOne({ _id: id });
      req.flash?.("success", "Faculty deleted.");
      return res.redirect("/admin/faculties");
    } catch (err) {
      console.error("DELETE FACULTY ERROR:", err);
      req.flash?.("error", "Failed to delete faculty.");
      return res.redirect("/admin/faculties");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Faculty } = req.models;
      const action = String(req.body.action || "").trim();

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No faculties selected.");
        return res.redirect("/admin/faculties");
      }

      if (action === "activate") {
        await Faculty.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected faculties activated.");
      } else if (action === "deactivate") {
        await Faculty.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected faculties deactivated.");
      } else if (action === "delete") {
        await Faculty.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected faculties deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/faculties");
    } catch (err) {
      console.error("FACULTY BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/faculties");
    }
  },

  importTemplate: async (_req, res) => {
    const rows = [
      [
        "name",
        "code",
        "status",
        "publicEmail",
        "phone",
        "officeLocation",
        "description",
        "dean",
        "departments",
        "programs",
        "courses",
      ],
      [
        "Faculty of Science",
        "SCI",
        "active",
        "science@example.edu",
        "+256700000000",
        "Main Block",
        "Handles science departments",
        "",
        "",
        "",
        "",
      ],
    ];

    const csv = rows
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="faculties-import-template.csv"');
    return res.send(csv);
  },

  importCsv: async (req, res) => {
    try {
      const { Faculty } = req.models;

      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/faculties");
      }

      const raw = String(req.file.buffer.toString("utf8") || "").trim();
      if (!raw) {
        req.flash?.("error", "Uploaded CSV is empty.");
        return res.redirect("/admin/faculties");
      }

      const rows = parseCsv(raw);
      if (rows.length < 2) {
        req.flash?.("error", "CSV must include a header row and at least one data row.");
        return res.redirect("/admin/faculties");
      }

      const headers = rows[0].map((h) => String(h || "").trim());
      const items = rows.slice(1);

      let created = 0;
      let skipped = 0;

      for (const cols of items) {
        const row = {};
        headers.forEach((h, i) => {
          row[h] = String(cols[i] || "").trim();
        });

        const name = String(row.name || "").trim();
        if (name.length < 2) {
          skipped += 1;
          continue;
        }

        let code = String(row.code || "").trim().toUpperCase();
        if (!code) code = slugCode(name);
        code = slugCode(code);

        const exists = await Faculty.findOne({ code }).select("_id").lean();
        if (exists) {
          skipped += 1;
          continue;
        }

        const dean = mongoose.Types.ObjectId.isValid(String(row.dean || "").trim())
          ? row.dean.trim()
          : null;

        const departments = cleanObjectIds(splitCsvList(row.departments));
        const programs = cleanObjectIds(splitCsvList(row.programs));
        const courses = cleanObjectIds(splitCsvList(row.courses));

        const departmentLabels = await buildLabelsFromIds(req, departments, "Department", (d) => d.name || d.title || d.code);
        const programLabels = await buildLabelsFromIds(req, programs, "Program", (p) => p.title || p.name || p.code);
        const courseLabels = await buildLabelsFromIds(req, courses, "Course", (c) => c.title || c.name || c.code);

        await Faculty.create({
          name,
          code,
          status: ["active", "inactive"].includes(row.status) ? row.status : "active",
          publicEmail: String(row.publicEmail || "").trim(),
          phone: String(row.phone || "").trim(),
          officeLocation: String(row.officeLocation || "").trim(),
          description: String(row.description || "").trim().slice(0, 1200),
          dean,
          departments,
          programs,
          courses,
          departmentLabels,
          programLabels,
          courseLabels,
          createdBy: req.user?._id || null,
        });

        created += 1;
      }

      req.flash?.("success", `Import completed. Created: ${created}, Skipped: ${skipped}.`);
      return res.redirect("/admin/faculties");
    } catch (err) {
      console.error("FACULTY IMPORT ERROR:", err);
      req.flash?.("error", "Failed to import CSV.");
      return res.redirect("/admin/faculties");
    }
  },
};