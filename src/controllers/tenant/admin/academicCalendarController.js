const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const {
  loadAcademicScopeLists,
  resolveAcademicScope,
  buildAcademicScopeFilter,
} = require("../../../utils/tenantAcademicScope");

const cleanStr = (v, max = 200) => String(v || "").trim().slice(0, max);
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const eventRules = [
  body("title").trim().isLength({ min: 2, max: 160 }).withMessage("Title is required (2-160 chars)."),
  body("type").trim().isLength({ min: 2, max: 40 }).withMessage("Type is required."),
  body("classGroup").optional({ checkFalsy: true }).custom(isObjId).withMessage("Invalid class."),
  body("sectionId").optional({ checkFalsy: true }).custom(isObjId).withMessage("Invalid section."),
  body("streamId").optional({ checkFalsy: true }).custom(isObjId).withMessage("Invalid stream."),
  body("academicYear").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("term").optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body("startDate").custom((v) => !!parseDate(v)).withMessage("Start date is required (YYYY-MM-DD)."),
  body("endDate").optional({ checkFalsy: true }).customSanitizer(parseDate),
  body("status").optional({ checkFalsy: true }).isIn(["active", "draft", "archived"]).withMessage("Invalid status."),
  body("location").optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 1200 }),
];

const kpiAgg = async (AcademicEvent, baseFilter) => {
  const rows = await AcademicEvent.aggregate([
    { $match: baseFilter },
    { $group: { _id: "$status", c: { $sum: 1 } } },
  ]);
  const m = Object.fromEntries(rows.map((r) => [r._id, r.c]));
  return {
    total: Object.values(m).reduce((a, b) => a + b, 0),
    active: m.active || 0,
    draft: m.draft || 0,
    archived: m.archived || 0,
  };
};

function buildScopePayload(scope) {
  return {
    classGroup: scope.payload.classId || null,
    className: scope.payload.className || "",
    sectionId: scope.payload.sectionId || null,
    sectionName: scope.payload.sectionName || "",
    sectionCode: scope.payload.sectionCode || "",
    streamId: scope.payload.streamId || null,
    streamName: scope.payload.streamName || "",
    streamCode: scope.payload.streamCode || "",
  };
}

// Simple CSV parser (supports quoted commas)
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

    if (!inQuotes && (ch === ",")) { row.push(cur); cur = ""; continue; }
    if (!inQuotes && (ch === "\n")) { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (ch !== "\r") cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter(r => r.some(x => String(x || "").trim() !== ""));
}

module.exports = {
  eventRules,

  // GET /admin/academic-calendar
  list: async (req, res) => {
    try {
      const { AcademicEvent, Class, Section, Stream } = req.models;

      const q = cleanStr(req.query.q, 120);
      const academicYear = cleanStr(req.query.academicYear, 20);
      const term = cleanStr(req.query.term, 40);
      const type = cleanStr(req.query.type, 40);
      const status = cleanStr(req.query.status, 20);
      const classGroup = cleanStr(req.query.classGroup, 80);
      const sectionId = cleanStr(req.query.sectionId, 80);
      const streamId = cleanStr(req.query.streamId, 80);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 18;

      const filter = { isDeleted: { $ne: true } };

      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { type: { $regex: q, $options: "i" } },
          { term: { $regex: q, $options: "i" } },
          { academicYear: { $regex: q, $options: "i" } },
          { className: { $regex: q, $options: "i" } },
          { sectionName: { $regex: q, $options: "i" } },
          { streamName: { $regex: q, $options: "i" } },
        ];
      }
      if (academicYear) filter.academicYear = academicYear;
      if (term) filter.term = term;
      if (type) filter.type = type;
      if (status) filter.status = status;
      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));

      const total = await AcademicEvent.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);

      let eventQuery = AcademicEvent.find(filter)
        .sort({ startDate: 1, createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage);

      if (Class) eventQuery = eventQuery.populate({ path: "classGroup", model: Class, select: "name code title" });
      if (Section) eventQuery = eventQuery.populate({ path: "sectionId", model: Section, select: "name code" });
      if (Stream) eventQuery = eventQuery.populate({ path: "streamId", model: Stream, select: "name code" });

      const [events, scopeLists] = await Promise.all([
        eventQuery.lean(),
        loadAcademicScopeLists(req),
      ]);

      const years = (await AcademicEvent.distinct("academicYear", { isDeleted: { $ne: true } }))
        .filter(Boolean).sort();

      const terms = (await AcademicEvent.distinct("term", { isDeleted: { $ne: true } }))
        .filter(Boolean).sort();

      const types = (await AcademicEvent.distinct("type", { isDeleted: { $ne: true } }))
        .filter(Boolean).sort();

      const kpis = await kpiAgg(AcademicEvent, { isDeleted: { $ne: true } });

      return res.render("tenant/admin/academic-calendar/index", {
        tenant: req.tenant || null,
        events,
        years: years.length ? years : ["2025/2026", "2026/2027"],
        terms: terms.length ? terms : ["Semester 1", "Semester 2"],
        types: types.length ? types : ["Semester","Registration","Exam","Holiday","Deadline","Meeting","Other"],
        classes: scopeLists.classes,
        sections: scopeLists.sections,
        streams: scopeLists.streams,
        kpis,
        csrfToken: res.locals.csrfToken || null,
        query: { q, academicYear, term, type, status, classGroup, sectionId, streamId, page, perPage, total, totalPages },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("ACADEMIC CALENDAR LIST ERROR:", err);
      return res.status(500).send("Failed to load academic calendar.");
    }
  },

  // POST /admin/academic-calendar
  create: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/academic-calendar");
      }

      const scope = await resolveAcademicScope(req, {
        classId: req.body.classGroup,
        sectionId: req.body.sectionId,
        streamId: req.body.streamId,
      });

      if (scope.errors.length) {
        req.flash?.("error", scope.errors.join(" "));
        return res.redirect("/admin/academic-calendar");
      }

      const doc = {
        title: cleanStr(req.body.title, 160),
        type: cleanStr(req.body.type, 40),
        ...buildScopePayload(scope),
        academicYear: cleanStr(req.body.academicYear, 20),
        term: cleanStr(req.body.term, 40),
        startDate: parseDate(req.body.startDate),
        endDate: parseDate(req.body.endDate),
        status: ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : "draft",
        location: cleanStr(req.body.location, 120),
        notes: cleanStr(req.body.notes, 1200),
        createdBy: req.user?._id || null,
      };

      // ensure end >= start if provided
      if (doc.endDate && doc.startDate && doc.endDate < doc.startDate) {
        req.flash?.("error", "End date cannot be before start date.");
        return res.redirect("/admin/academic-calendar");
      }

      await AcademicEvent.create(doc);
      req.flash?.("success", "Event created.");
      return res.redirect("/admin/academic-calendar");
    } catch (err) {
      console.error("ACADEMIC CALENDAR CREATE ERROR:", err);
      req.flash?.("error", "Failed to create event.");
      return res.redirect("/admin/academic-calendar");
    }
  },

  // POST /admin/academic-calendar/:id
  update: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
        return res.redirect("/admin/academic-calendar");
      }

      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid event id.");
        return res.redirect("/admin/academic-calendar");
      }

      const scope = await resolveAcademicScope(req, {
        classId: req.body.classGroup,
        sectionId: req.body.sectionId,
        streamId: req.body.streamId,
      });

      if (scope.errors.length) {
        req.flash?.("error", scope.errors.join(" "));
        return res.redirect("/admin/academic-calendar");
      }

      const update = {
        title: cleanStr(req.body.title, 160),
        type: cleanStr(req.body.type, 40),
        ...buildScopePayload(scope),
        academicYear: cleanStr(req.body.academicYear, 20),
        term: cleanStr(req.body.term, 40),
        startDate: parseDate(req.body.startDate),
        endDate: parseDate(req.body.endDate),
        status: ["active", "draft", "archived"].includes(req.body.status) ? req.body.status : "draft",
        location: cleanStr(req.body.location, 120),
        notes: cleanStr(req.body.notes, 1200),
        updatedBy: req.user?._id || null,
      };

      if (update.endDate && update.startDate && update.endDate < update.startDate) {
        req.flash?.("error", "End date cannot be before start date.");
        return res.redirect("/admin/academic-calendar");
      }

      await AcademicEvent.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Event updated.");
      return res.redirect("/admin/academic-calendar");
    } catch (err) {
      console.error("ACADEMIC CALENDAR UPDATE ERROR:", err);
      req.flash?.("error", "Failed to update event.");
      return res.redirect("/admin/academic-calendar");
    }
  },

  // POST /admin/academic-calendar/:id/archive
  archive: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid event id.");
        return res.redirect("/admin/academic-calendar");
      }
      await AcademicEvent.updateOne({ _id: id }, { $set: { status: "archived" } });
      req.flash?.("success", "Event archived.");
      return res.redirect("/admin/academic-calendar");
    } catch (err) {
      console.error("ACADEMIC CALENDAR ARCHIVE ERROR:", err);
      req.flash?.("error", "Failed to archive event.");
      return res.redirect("/admin/academic-calendar");
    }
  },

  // POST /admin/academic-calendar/:id/delete
  remove: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid event id.");
        return res.redirect("/admin/academic-calendar");
      }
      await AcademicEvent.deleteOne({ _id: id });
      req.flash?.("success", "Event deleted.");
      return res.redirect("/admin/academic-calendar");
    } catch (err) {
      console.error("ACADEMIC CALENDAR DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete event.");
      return res.redirect("/admin/academic-calendar");
    }
  },

  // POST /admin/academic-calendar/bulk-archive
  bulkArchive: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No events selected.");
        return res.redirect("/admin/academic-calendar");
      }

      await AcademicEvent.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
      req.flash?.("success", "Selected events archived.");
      return res.redirect("/admin/academic-calendar");
    } catch (err) {
      console.error("ACADEMIC CALENDAR BULK ERROR:", err);
      req.flash?.("error", "Bulk archive failed.");
      return res.redirect("/admin/academic-calendar");
    }
  },

  // POST /admin/academic-calendar/import
  importCsv: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;

      if (!req.file?.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/academic-calendar");
      }

      const text = req.file.buffer.toString("utf8");
      const rows = parseCsv(text);
      if (!rows.length) {
        req.flash?.("error", "CSV is empty.");
        return res.redirect("/admin/academic-calendar");
      }

      const headers = rows[0].map(h => cleanStr(h, 80));
      const idx = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

      const iTitle = idx("title");
      const iType = idx("type");
      const iYear = idx("academicYear");
      const iTerm = idx("term");
      const iClass = idx("classId");
      const iSection = idx("sectionId");
      const iStream = idx("streamId");
      const iStart = idx("startDate");
      const iEnd = idx("endDate");
      const iStatus = idx("status");
      const iLoc = idx("location");
      const iNotes = idx("notes");

      if (iTitle < 0 || iType < 0 || iStart < 0) {
        req.flash?.("error", "CSV must include headers: title,type,startDate (minimum).");
        return res.redirect("/admin/academic-calendar");
      }

      const docs = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const title = cleanStr(row[iTitle], 160);
        const type = cleanStr(row[iType], 40);
        const startDate = parseDate(row[iStart]);

        if (!title || !type || !startDate) continue;

        const endDate = iEnd >= 0 ? parseDate(row[iEnd]) : null;
        const status = iStatus >= 0 ? cleanStr(row[iStatus], 20).toLowerCase() : "draft";
        const scope = await resolveAcademicScope(req, {
          classId: iClass >= 0 ? row[iClass] : "",
          sectionId: iSection >= 0 ? row[iSection] : "",
          streamId: iStream >= 0 ? row[iStream] : "",
        });

        if (scope.errors.length) continue;

        docs.push({
          title,
          type,
          ...buildScopePayload(scope),
          academicYear: iYear >= 0 ? cleanStr(row[iYear], 20) : "",
          term: iTerm >= 0 ? cleanStr(row[iTerm], 40) : "",
          startDate,
          endDate,
          status: ["active", "draft", "archived"].includes(status) ? status : "draft",
          location: iLoc >= 0 ? cleanStr(row[iLoc], 120) : "",
          notes: iNotes >= 0 ? cleanStr(row[iNotes], 1200) : "",
          createdBy: req.user?._id || null,
        });
      }

      if (!docs.length) {
        req.flash?.("error", "No valid rows found in CSV.");
        return res.redirect("/admin/academic-calendar");
      }

      await AcademicEvent.insertMany(docs, { ordered: false });
      req.flash?.("success", `Imported ${docs.length} event(s).`);
      return res.redirect("/admin/academic-calendar");
    } catch (err) {
      console.error("ACADEMIC CALENDAR IMPORT ERROR:", err);
      req.flash?.("error", "Import failed. Check CSV format.");
      return res.redirect("/admin/academic-calendar");
    }
  },

  // GET /admin/academic-calendar/export
  exportCsv: async (req, res) => {
    try {
      const { AcademicEvent } = req.models;

      const q = cleanStr(req.query.q, 120);
      const academicYear = cleanStr(req.query.academicYear, 20);
      const term = cleanStr(req.query.term, 40);
      const type = cleanStr(req.query.type, 40);
      const status = cleanStr(req.query.status, 20);
      const classGroup = cleanStr(req.query.classGroup, 80);
      const sectionId = cleanStr(req.query.sectionId, 80);
      const streamId = cleanStr(req.query.streamId, 80);

      const filter = { isDeleted: { $ne: true } };
      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { type: { $regex: q, $options: "i" } },
          { term: { $regex: q, $options: "i" } },
          { academicYear: { $regex: q, $options: "i" } },
          { className: { $regex: q, $options: "i" } },
          { sectionName: { $regex: q, $options: "i" } },
          { streamName: { $regex: q, $options: "i" } },
        ];
      }
      if (academicYear) filter.academicYear = academicYear;
      if (term) filter.term = term;
      if (type) filter.type = type;
      if (status) filter.status = status;
      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));

      const rows = await AcademicEvent.find(filter).sort({ startDate: 1 }).lean();

      const esc = (s) => {
        const v = String(s ?? "");
        if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
        return v;
      };

      const header = ["title","type","class","section","stream","academicYear","term","startDate","endDate","status","location","notes"];
      const lines = [header.join(",")];

      rows.forEach(r => {
        lines.push([
          esc(r.title),
          esc(r.type),
          esc(r.className || ""),
          esc(r.sectionName || ""),
          esc(r.streamName || ""),
          esc(r.academicYear || ""),
          esc(r.term || ""),
          esc(r.startDate ? new Date(r.startDate).toISOString().slice(0,10) : ""),
          esc(r.endDate ? new Date(r.endDate).toISOString().slice(0,10) : ""),
          esc(r.status || "draft"),
          esc(r.location || ""),
          esc(r.notes || ""),
        ].join(","));
      });

      const csv = lines.join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="academic-calendar.csv"`);
      return res.send(csv);
    } catch (err) {
      console.error("ACADEMIC CALENDAR EXPORT ERROR:", err);
      return res.status(500).send("Export failed.");
    }
  },
};
