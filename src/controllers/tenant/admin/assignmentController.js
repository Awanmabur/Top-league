const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

/* -----------------------
   Helpers
------------------------ */
const cleanStr = (v, max = 5000) => String(v || "").trim().slice(0, max);
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const cleanList = (vals, maxItems = 30, maxLen = 500) => {
  const arr = Array.isArray(vals) ? vals : (vals ? [vals] : []);
  return arr
    .map((s) => cleanStr(s, maxLen).replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, maxItems);
};

const parseDateTime = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  // Accept "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm"
  const fixed = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(fixed);
  return isNaN(d.getTime()) ? null : d;
};

// Simple CSV parser (handles quoted commas)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }

    if (!inQuotes && ch === ",") { row.push(cur); cur = ""; continue; }
    if (!inQuotes && ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (ch !== "\r") cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter(r => r.some(x => String(x || "").trim() !== ""));
}

const csvEsc = (s) => {
  const v = String(s ?? "");
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
};

const kpiAgg = async (Assignment, baseMatch) => {
  const rows = await Assignment.aggregate([
    { $match: baseMatch },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);
  const m = Object.fromEntries(rows.map((r) => [r._id, r.c]));
  return {
    total: Object.values(m).reduce((a, b) => a + b, 0),
    published: m.published || 0,
    draft: m.draft || 0,
    archived: m.archived || 0,
    closed: m.closed || 0,
  };
};

// ✅ Strong guard so you never get "Cannot read ... of undefined" again
const requireTenantModel = (req, name) => {
  const models = req?.models;
  if (!models) {
    const e = new Error("Tenant models not attached to request (req.models is missing). Check tenant middleware order.");
    e.code = "TENANT_MODELS_MISSING";
    throw e;
  }
  const model = models[name];
  if (!model) {
    // log keys once to make debugging fast
    console.log(`[ASSIGNMENTS] Missing model "${name}". Available models:`, Object.keys(models));
    const e = new Error(`Tenant model "${name}" not loaded. Add it to tenant model registry/loader.`);
    e.code = "TENANT_MODEL_NOT_LOADED";
    throw e;
  }
  return model;
};

/* -----------------------
   Validation Rules
------------------------ */
const assignmentRules = [
  body("title").trim().isLength({ min: 2, max: 200 }).withMessage("Title is required (2-200 chars)."),
  body("course").custom((v) => isObjId(v)).withMessage("Course is required."),
  body("dueDate").optional({ checkFalsy: true }).custom((v) => !!parseDateTime(v)).withMessage("Invalid due date."),
  body("totalPoints").optional({ checkFalsy: true }).isInt({ min: 0, max: 1000 }).toInt(),
  body("status")
    .optional({ checkFalsy: true })
    .isIn(["draft", "published", "closed", "archived"])
    .withMessage("Invalid status."),
  body("instructions").optional({ checkFalsy: true }).trim().isLength({ max: 4000 }),
  body("rubric").optional({ checkFalsy: true }).trim().isLength({ max: 4000 }),
];

/* -----------------------
   Controller
------------------------ */
module.exports = {
  assignmentRules,

  // GET /admin/assignments
  list: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      // Course can be optional in some setups, so don’t hard-fail
      const Course = req.models?.Course || null;

      const q = cleanStr(req.query.q, 120);
      const course = cleanStr(req.query.course, 80);
      const status = cleanStr(req.query.status, 20);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 18;

      const filter = { isDeleted: { $ne: true } };

      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { instructions: { $regex: q, $options: "i" } },
          { rubric: { $regex: q, $options: "i" } },
          { courseName: { $regex: q, $options: "i" } },
        ];
      }
      if (course && isObjId(course)) filter.course = course;
      if (status) filter.status = status;

      const total = await Assignment.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);

      const assignments = await Assignment.find(filter)
        .populate({ path: "course", select: "title code name" })
        .sort({ dueDate: 1, createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean();

      const courses = Course
        ? await Course.find({ isDeleted: { $ne: true } })
            .sort({ title: 1, code: 1 })
            .select("title code name")
            .lean()
        : [];

      const kpis = await kpiAgg(Assignment, { isDeleted: { $ne: true } });

      return res.render("tenant/admin/assignments/index", {
        tenant: req.tenant || null,
        assignments,
        courses,
        kpis,
        csrfToken: res.locals.csrfToken || null,
        query: { q, course, status, page, perPage, total, totalPages },
      });
    } catch (err) {
      console.error("ASSIGNMENTS LIST ERROR:", err);
      // More helpful message in dev; keep generic in prod
      return res.status(500).send("Failed to load assignments.");
    }
  },

  // POST /admin/assignments
  create: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const Course = requireTenantModel(req, "Course"); // creating assignment needs course lookup

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/assignments");
      }

      const title = cleanStr(req.body.title, 200);
      const courseId = cleanStr(req.body.course, 80);

      const course = await Course.findById(courseId).select("title code name").lean();
      if (!course) {
        req.flash?.("error", "Course not found.");
        return res.redirect("/admin/assignments");
      }

      const dueDate = parseDateTime(req.body.dueDate);
      const totalPoints = Math.max(0, Math.min(Number(req.body.totalPoints || 100), 1000));

      const status = ["draft", "published", "closed", "archived"].includes(req.body.status)
        ? req.body.status
        : "draft";

      const instructions = cleanStr(req.body.instructions, 4000);
      const rubric = cleanStr(req.body.rubric, 4000);
      const attachments = cleanList(req.body["attachments[]"] ?? req.body.attachments, 30, 500);

      await Assignment.create({
        title,
        course: courseId,
        courseName: course.title || course.code || course.name || "",
        dueDate,
        totalPoints,
        status,
        instructions,
        rubric,
        attachments,
        createdBy: req.user?._id || null,
      });

      req.flash?.("success", "Assignment created.");
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT CREATE ERROR:", err);
      req.flash?.("error", "Failed to create assignment.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/:id
  update: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const Course = requireTenantModel(req, "Course");

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/assignments");
      }

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid assignment id.");
        return res.redirect("/admin/assignments");
      }

      const title = cleanStr(req.body.title, 200);
      const courseId = cleanStr(req.body.course, 80);

      const course = await Course.findById(courseId).select("title code name").lean();
      if (!course) {
        req.flash?.("error", "Course not found.");
        return res.redirect("/admin/assignments");
      }

      const update = {
        title,
        course: courseId,
        courseName: course.title || course.code || course.name || "",
        dueDate: parseDateTime(req.body.dueDate),
        totalPoints: Math.max(0, Math.min(Number(req.body.totalPoints || 100), 1000)),
        status: ["draft", "published", "closed", "archived"].includes(req.body.status) ? req.body.status : "draft",
        instructions: cleanStr(req.body.instructions, 4000),
        rubric: cleanStr(req.body.rubric, 4000),
        attachments: cleanList(req.body["attachments[]"] ?? req.body.attachments, 30, 500),
        updatedBy: req.user?._id || null,
        updatedAt: new Date(),
      };

      await Assignment.updateOne({ _id: id, isDeleted: { $ne: true } }, { $set: update }, { runValidators: true });

      req.flash?.("success", "Assignment updated.");
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT UPDATE ERROR:", err);
      req.flash?.("error", "Failed to update assignment.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/:id/publish
  publish: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid assignment id.");
        return res.redirect("/admin/assignments");
      }
      await Assignment.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { status: "published", updatedAt: new Date() } }
      );
      req.flash?.("success", "Assignment published.");
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT PUBLISH ERROR:", err);
      req.flash?.("error", "Failed to publish assignment.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/:id/unpublish
  unpublish: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid assignment id.");
        return res.redirect("/admin/assignments");
      }
      await Assignment.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { status: "draft", updatedAt: new Date() } }
      );
      req.flash?.("success", "Assignment set to draft.");
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT UNPUBLISH ERROR:", err);
      req.flash?.("error", "Failed to unpublish assignment.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/:id/archive
  archive: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid assignment id.");
        return res.redirect("/admin/assignments");
      }
      await Assignment.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        { $set: { status: "archived", updatedAt: new Date() } }
      );
      req.flash?.("success", "Assignment archived.");
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT ARCHIVE ERROR:", err);
      req.flash?.("error", "Failed to archive assignment.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/:id/delete  (✅ soft delete to match your filters)
  remove: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid assignment id.");
        return res.redirect("/admin/assignments");
      }

      await Assignment.updateOne(
        { _id: id, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: req.user?._id || null,
          },
        }
      );

      req.flash?.("success", "Assignment deleted.");
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete assignment.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/bulk
  bulk: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");

      const action = cleanStr(req.body.action, 30).toLowerCase();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No assignments selected.");
        return res.redirect("/admin/assignments");
      }

      const statusMap = {
        publish: "published",
        archive: "archived",
        unpublish: "draft",
        close: "closed",
      };

      if (!statusMap[action]) {
        req.flash?.("error", "Invalid bulk action.");
        return res.redirect("/admin/assignments");
      }

      await Assignment.updateMany(
        { _id: { $in: ids }, isDeleted: { $ne: true } },
        { $set: { status: statusMap[action], updatedAt: new Date() } }
      );

      req.flash?.("success", `Bulk "${action}" applied to ${ids.length} assignment(s).`);
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/assignments");
    }
  },

  // POST /admin/assignments/import
  importCsv: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");
      const Course = requireTenantModel(req, "Course");

      if (!req.file?.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/assignments");
      }

      const text = req.file.buffer.toString("utf8");
      const rows = parseCsv(text);
      if (!rows.length) {
        req.flash?.("error", "CSV is empty.");
        return res.redirect("/admin/assignments");
      }

      const headers = rows[0].map(h => cleanStr(h, 60));
      const idx = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

      const iTitle = idx("title");
      const iCourseCode = idx("courseCode");
      const iDue = idx("dueDate");
      const iPoints = idx("totalPoints");
      const iStatus = idx("status");
      const iInstr = idx("instructions");
      const iRubric = idx("rubric");
      const iAttach = idx("attachments");

      if (iTitle < 0 || iCourseCode < 0) {
        req.flash?.("error", "CSV must include headers: title, courseCode (minimum).");
        return res.redirect("/admin/assignments");
      }

      // Build a fast map of courses by code (UPPERCASE)
      const allCourses = await Course.find({ isDeleted: { $ne: true } }).select("title code name").lean();

      const courseByCode = new Map();
      allCourses.forEach(c => {
        const code = String(c.code || "").trim().toUpperCase();
        if (code) courseByCode.set(code, c);
      });

      const docs = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];

        const title = cleanStr(row[iTitle], 200);
        const courseCode = cleanStr(row[iCourseCode], 40).toUpperCase();

        if (!title || !courseCode) continue;

        const course = courseByCode.get(courseCode);
        if (!course) continue; // skip unknown course codes

        const dueDate = iDue >= 0 ? parseDateTime(row[iDue]) : null;

        const totalPoints = iPoints >= 0
          ? Math.max(0, Math.min(Number(row[iPoints] || 100), 1000))
          : 100;

        const rawStatus = iStatus >= 0 ? cleanStr(row[iStatus], 20).toLowerCase() : "draft";
        const status = ["draft","published","closed","archived"].includes(rawStatus) ? rawStatus : "draft";

        const instructions = iInstr >= 0 ? cleanStr(row[iInstr], 4000) : "";
        const rubric = iRubric >= 0 ? cleanStr(row[iRubric], 4000) : "";

        const attachments = iAttach >= 0
          ? cleanStr(row[iAttach], 5000).split("||").map(x => x.trim()).filter(Boolean).slice(0, 30)
          : [];

        docs.push({
          title,
          course: course._id,
          courseName: course.title || course.code || course.name || "",
          dueDate,
          totalPoints,
          status,
          instructions,
          rubric,
          attachments,
          createdBy: req.user?._id || null,
        });
      }

      if (!docs.length) {
        req.flash?.("error", "No valid rows imported. Ensure courseCode matches existing Course.code.");
        return res.redirect("/admin/assignments");
      }

      await Assignment.insertMany(docs, { ordered: false });
      req.flash?.("success", `Imported ${docs.length} assignment(s).`);
      return res.redirect("/admin/assignments");
    } catch (err) {
      console.error("ASSIGNMENT IMPORT ERROR:", err);
      req.flash?.("error", "Import failed. Check CSV format and course codes.");
      return res.redirect("/admin/assignments");
    }
  },

  // GET /admin/assignments/export
  exportCsv: async (req, res) => {
    try {
      const Assignment = requireTenantModel(req, "Assignment");

      const q = cleanStr(req.query.q, 120);
      const course = cleanStr(req.query.course, 80);
      const status = cleanStr(req.query.status, 20);

      const filter = { isDeleted: { $ne: true } };
      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { instructions: { $regex: q, $options: "i" } },
          { rubric: { $regex: q, $options: "i" } },
          { courseName: { $regex: q, $options: "i" } },
        ];
      }
      if (course && isObjId(course)) filter.course = course;
      if (status) filter.status = status;

      const rows = await Assignment.find(filter)
        .populate({ path: "course", select: "code title" })
        .sort({ dueDate: 1, createdAt: -1 })
        .lean();

      const header = ["title","courseCode","dueDate","totalPoints","status","instructions","rubric","attachments"];
      const lines = [header.join(",")];

      rows.forEach(a => {
        const courseCode = a.course?.code || "";
        const due = a.dueDate ? new Date(a.dueDate).toISOString().slice(0,16).replace("T"," ") : "";
        const attachments = Array.isArray(a.attachments) ? a.attachments.join("||") : "";

        lines.push([
          csvEsc(a.title),
          csvEsc(courseCode),
          csvEsc(due),
          csvEsc(a.totalPoints ?? 100),
          csvEsc(a.status || "draft"),
          csvEsc(a.instructions || ""),
          csvEsc(a.rubric || ""),
          csvEsc(attachments),
        ].join(","));
      });

      const csv = lines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="assignments.csv"');
      return res.send(csv);
    } catch (err) {
      console.error("ASSIGNMENT EXPORT ERROR:", err);
      return res.status(500).send("Export failed.");
    }
  },
};
