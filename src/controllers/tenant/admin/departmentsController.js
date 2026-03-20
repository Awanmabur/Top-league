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

function deptInitials(name) {
  const stop = new Set(["DEPARTMENT", "OF", "THE", "AND", "SCHOOL", "FACULTY"]);
  const words = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !stop.has(w));

  if (!words.length) return "DEPT";
  const letters = words.map((w) => w[0]).join("").slice(0, 8);
  if (letters.length >= 2) return letters;
  return (words[0] || "DEPT").slice(0, 4);
}

function cleanIds(val, limit = 500) {
  const arr = Array.isArray(val) ? val : (val ? [val] : []);
  const out = [];
  const seen = new Set();

  for (const x of arr) {
    const s = String(x || "").trim();
    if (!mongoose.Types.ObjectId.isValid(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }

  return out;
}

function parseCsv(text) {
  const rows = [];
  let cur = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cur);
      cur = "";
      if (row.some((x) => String(x || "").trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((x) => String(x || "").trim() !== "")) rows.push(row);
  }

  return rows;
}

async function buildLabelsFromSelections(models, programIds, courseIds) {
  const { Program, Course } = models;

  const programs = programIds.length
    ? await Program.find({ _id: { $in: programIds } }).select("name code").lean()
    : [];

  const courses = courseIds.length
    ? await Course.find({ _id: { $in: courseIds } }).select("code title").lean()
    : [];

  const programLabels = programs
    .map((p) => (p.code ? `${p.code} ${p.name}` : p.name))
    .filter(Boolean)
    .slice(0, 500);

  const courseCodes = courses
    .map((c) => c.code)
    .filter(Boolean)
    .slice(0, 500);

  return { programLabels, courseCodes };
}

async function ensureUniqueCode(Department, baseCode, excludeId = null) {
  let code = slugCode(baseCode);
  if (!code) code = "DEPT";

  let n = 1;
  while (true) {
    const query = excludeId ? { code, _id: { $ne: excludeId } } : { code };
    const exists = await Department.findOne(query).select("_id").lean();
    if (!exists) return code;
    n += 1;
    code = slugCode(`${baseCode}-${n}`);
  }
}

const deptRules = [
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

  body("status")
    .optional({ checkFalsy: true })
    .isIn(["active", "inactive"])
    .withMessage("Invalid status."),

  body("faculty")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(String(v)))
    .withMessage("Invalid faculty."),

  body("publicEmail")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Invalid email.")
    .bail()
    .normalizeEmail(),

  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 40 }),

  body("officeLocation")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 120 }),

  body("description")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 240 }),

  body("notes")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 }),

  body("headOfDepartment")
    .optional({ checkFalsy: true })
    .custom((v) => !v || mongoose.Types.ObjectId.isValid(String(v)))
    .withMessage("Invalid HOD."),
];

module.exports = {
  deptRules,

  list: async (req, res) => {
    try {
      const { Department, Staff, Faculty, Program, Course } = req.models;

      const q = String(req.query.q || "").trim();
      const faculty = String(req.query.faculty || "").trim();
      const status = String(req.query.status || "").trim();

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};

      if (q) {
        filter.$or = [
          { name: { $regex: q, $options: "i" } },
          { code: { $regex: q, $options: "i" } },
          { publicEmail: { $regex: q, $options: "i" } },
          { phone: { $regex: q, $options: "i" } },
        ];
      }

      if (faculty && mongoose.Types.ObjectId.isValid(faculty)) {
        filter.faculty = faculty;
      }

      if (status) filter.status = status;

      const total = await Department.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const departments = await Department.find(filter)
        .populate({ path: "headOfDepartment", select: "fullName name role" })
        .populate({ path: "faculty", select: "name code status" })
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const faculties = Faculty
        ? await Faculty.find({ status: "active" }).select("name code").sort({ name: 1 }).lean()
        : [];

      const staffList = Staff
        ? await Staff.find({})
            .select("fullName name role")
            .sort({ fullName: 1, name: 1 })
            .limit(500)
            .lean()
        : [];

      const programs = Program
        ? await Program.find({})
            .select("name code")
            .sort({ name: 1 })
            .limit(2000)
            .lean()
        : [];

      const courses = Course
        ? await Course.find({})
            .select("title code")
            .sort({ title: 1 })
            .limit(3000)
            .lean()
        : [];

      const kpis = {
        total,
        active: await Department.countDocuments({ ...filter, status: "active" }),
        inactive: await Department.countDocuments({ ...filter, status: "inactive" }),
        withoutHod: await Department.countDocuments({
          ...filter,
          $or: [
            { headOfDepartment: { $exists: false } },
            { headOfDepartment: null },
          ],
        }),
      };

      return res.render("tenant/admin/departments/index", {
        tenant: req.tenant || null,
        departments,
        faculties,
        staffList,
        programs,
        courses,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          faculty,
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
      console.error("DEPARTMENTS LIST ERROR:", err);
      return res.status(500).send("Failed to load departments.");
    }
  },

  create: async (req, res) => {
    const { Department, Faculty } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/departments");
    }

    try {
      const name = String(req.body.name || "").trim();

      const facultyId = req.body.faculty && mongoose.Types.ObjectId.isValid(req.body.faculty)
        ? String(req.body.faculty)
        : null;

      const facultyDoc = facultyId
        ? await Faculty.findById(facultyId).select("code").lean()
        : null;

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) {
        const base = facultyDoc?.code
          ? `${facultyDoc.code}-${deptInitials(name)}`
          : deptInitials(name);
        code = await ensureUniqueCode(Department, base);
      } else {
        code = await ensureUniqueCode(Department, slugCode(code));
      }

      const programIds = cleanIds(req.body["programs[]"] ?? req.body.programs);
      const courseIds = cleanIds(req.body["courses[]"] ?? req.body.courses);
      const { programLabels, courseCodes } = await buildLabelsFromSelections(req.models, programIds, courseIds);

      await Department.create({
        name,
        code,
        status: ["active", "inactive"].includes(req.body.status) ? req.body.status : "active",
        faculty: facultyId,
        officeLocation: String(req.body.officeLocation || "").trim().slice(0, 120),
        publicEmail: String(req.body.publicEmail || "").trim().toLowerCase().slice(0, 160),
        phone: String(req.body.phone || "").trim().slice(0, 40),
        description: String(req.body.description || "").trim().slice(0, 240),
        notes: String(req.body.notes || "").trim().slice(0, 2000),
        headOfDepartment: req.body.headOfDepartment ? String(req.body.headOfDepartment) : null,
        programs: programIds,
        courses: courseIds,
        programLabels,
        courseCodes,
        createdBy: req.user?._id || null,
      });

      req.flash?.("success", "Department created.");
      return res.redirect("/admin/departments");
    } catch (err) {
      console.error("CREATE DEPARTMENT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Department code already exists.");
      else req.flash?.("error", "Failed to create department.");
      return res.redirect("/admin/departments");
    }
  },

  update: async (req, res) => {
    const { Department, Faculty } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/departments");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid department id.");
        return res.redirect("/admin/departments");
      }

      const current = await Department.findById(id).lean();
      if (!current) {
        req.flash?.("error", "Department not found.");
        return res.redirect("/admin/departments");
      }

      const name = String(req.body.name || current.name || "").trim();

      const facultyId = req.body.faculty && mongoose.Types.ObjectId.isValid(req.body.faculty)
        ? String(req.body.faculty)
        : null;

      const facultyDoc = facultyId
        ? await Faculty.findById(facultyId).select("code").lean()
        : null;

      let code = String(req.body.code || "").trim().toUpperCase();
      if (!code) {
        const base = facultyDoc?.code
          ? `${facultyDoc.code}-${deptInitials(name)}`
          : deptInitials(name);
        code = await ensureUniqueCode(Department, base, id);
      } else {
        code = await ensureUniqueCode(Department, slugCode(code), id);
      }

      const programIds = cleanIds(req.body["programs[]"] ?? req.body.programs);
      const courseIds = cleanIds(req.body["courses[]"] ?? req.body.courses);
      const { programLabels, courseCodes } = await buildLabelsFromSelections(req.models, programIds, courseIds);

      await Department.updateOne(
        { _id: id },
        {
          $set: {
            name,
            code,
            status: ["active", "inactive"].includes(req.body.status) ? req.body.status : current.status,
            faculty: facultyId,
            officeLocation: String(req.body.officeLocation || "").trim().slice(0, 120),
            publicEmail: String(req.body.publicEmail || "").trim().toLowerCase().slice(0, 160),
            phone: String(req.body.phone || "").trim().slice(0, 40),
            description: String(req.body.description || "").trim().slice(0, 240),
            notes: String(req.body.notes || "").trim().slice(0, 2000),
            headOfDepartment: req.body.headOfDepartment ? String(req.body.headOfDepartment) : null,
            programs: programIds,
            courses: courseIds,
            programLabels,
            courseCodes,
            updatedBy: req.user?._id || null,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Department updated.");
      return res.redirect("/admin/departments");
    } catch (err) {
      console.error("UPDATE DEPARTMENT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Department code already exists.");
      else req.flash?.("error", "Failed to update department.");
      return res.redirect("/admin/departments");
    }
  },

  remove: async (req, res) => {
    try {
      const { Department } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid department id.");
        return res.redirect("/admin/departments");
      }

      await Department.deleteOne({ _id: id });
      req.flash?.("success", "Department deleted.");
      return res.redirect("/admin/departments");
    } catch (err) {
      console.error("DELETE DEPARTMENT ERROR:", err);
      req.flash?.("error", "Failed to delete department.");
      return res.redirect("/admin/departments");
    }
  },

  bulkStatus: async (req, res) => {
    try {
      const { Department } = req.models;

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      const status = String(req.body.status || "").trim();

      if (!ids.length) {
        req.flash?.("error", "No departments selected.");
        return res.redirect("/admin/departments");
      }

      if (!["active", "inactive"].includes(status)) {
        req.flash?.("error", "Invalid bulk status.");
        return res.redirect("/admin/departments");
      }

      await Department.updateMany({ _id: { $in: ids } }, { $set: { status } });
      req.flash?.("success", "Selected departments updated.");
      return res.redirect("/admin/departments");
    } catch (err) {
      console.error("BULK STATUS DEPARTMENT ERROR:", err);
      req.flash?.("error", "Bulk status update failed.");
      return res.redirect("/admin/departments");
    }
  },

  bulkDelete: async (req, res) => {
    try {
      const { Department } = req.models;

      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No departments selected.");
        return res.redirect("/admin/departments");
      }

      await Department.deleteMany({ _id: { $in: ids } });
      req.flash?.("success", "Selected departments deleted.");
      return res.redirect("/admin/departments");
    } catch (err) {
      console.error("BULK DELETE DEPARTMENT ERROR:", err);
      req.flash?.("error", "Bulk delete failed.");
      return res.redirect("/admin/departments");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Department, Faculty } = req.models;

      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/departments");
      }

      const raw = String(req.file.buffer.toString("utf8") || "").replace(/^\uFEFF/, "");
      const rows = parseCsv(raw);

      if (!rows.length) {
        req.flash?.("error", "CSV file is empty.");
        return res.redirect("/admin/departments");
      }

      const headers = rows[0].map((h) => String(h || "").trim());
      const bodyRows = rows.slice(1);

      const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

      const iName = idx("name");
      const iCode = idx("code");
      const iFacultyCode = idx("facultyCode");
      const iStatus = idx("status");
      const iOffice = idx("officeLocation");
      const iEmail = idx("publicEmail");
      const iPhone = idx("phone");
      const iNotes = idx("notes");

      if (iName === -1) {
        req.flash?.("error", "CSV must include a 'name' column.");
        return res.redirect("/admin/departments");
      }

      const facultyDocs = await Faculty.find({}).select("_id code").lean();
      const facultyByCode = new Map(
        facultyDocs
          .filter((f) => f.code)
          .map((f) => [String(f.code).trim().toUpperCase(), String(f._id)])
      );

      let created = 0;
      let skipped = 0;

      for (const row of bodyRows.slice(0, 2000)) {
        const name = String(row[iName] || "").trim();
        if (!name) {
          skipped += 1;
          continue;
        }

        const facultyCode = iFacultyCode >= 0 ? String(row[iFacultyCode] || "").trim().toUpperCase() : "";
        const facultyId = facultyCode && facultyByCode.has(facultyCode)
          ? facultyByCode.get(facultyCode)
          : null;

        let code = iCode >= 0 ? String(row[iCode] || "").trim().toUpperCase() : "";
        if (!code) {
          const base = facultyCode
            ? `${facultyCode}-${deptInitials(name)}`
            : deptInitials(name);
          code = await ensureUniqueCode(Department, base);
        } else {
          code = await ensureUniqueCode(Department, slugCode(code));
        }

        try {
          await Department.create({
            name: name.slice(0, 160),
            code,
            faculty: facultyId,
            status: String(row[iStatus] || "").trim() === "inactive" ? "inactive" : "active",
            officeLocation: iOffice >= 0 ? String(row[iOffice] || "").trim().slice(0, 120) : "",
            publicEmail: iEmail >= 0 ? String(row[iEmail] || "").trim().toLowerCase().slice(0, 160) : "",
            phone: iPhone >= 0 ? String(row[iPhone] || "").trim().slice(0, 40) : "",
            notes: iNotes >= 0 ? String(row[iNotes] || "").trim().slice(0, 2000) : "",
            createdBy: req.user?._id || null,
          });
          created += 1;
        } catch (e) {
          skipped += 1;
        }
      }

      req.flash?.("success", `Import completed. Created ${created}, skipped ${skipped}.`);
      return res.redirect("/admin/departments");
    } catch (err) {
      console.error("IMPORT DEPARTMENTS CSV ERROR:", err);
      req.flash?.("error", "Failed to import CSV.");
      return res.redirect("/admin/departments");
    }
  },
};