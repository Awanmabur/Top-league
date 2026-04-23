// src/controllers/tenant/admissions/intakeController.js
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function cleanStr(v) {
  return (v === null || v === undefined) ? "" : String(v).trim();
}

function cleanUpper(v) {
  return cleanStr(v).toUpperCase().replace(/\s+/g, "-");
}

function toInt(v, def = 0) {
  const n = parseInt(String(v || ""), 10);
  return Number.isFinite(n) ? n : def;
}

function safeObjId(v) {
  return (v && String(v).match(/^[a-f0-9]{24}$/i)) ? String(v) : null;
}

function slugPart(v) {
  return cleanStr(v)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 4);
}

async function buildUniqueTermCode(Intake, { name = "", term = "", year = null, excludeId = null } = {}) {
  const base = [slugPart(term || name) || "TERM", String(year || new Date().getFullYear()).slice(-2)].filter(Boolean).join("");
  let counter = 1;
  while (counter < 10000) {
    const code = `${base}${String(counter).padStart(2, "0")}`;
    const exists = await Intake.findOne({
      _id: excludeId ? { $ne: excludeId } : { $exists: true },
      code,
      isDeleted: { $ne: true },
    }).select("_id").lean();
    if (!exists) return code;
    counter += 1;
  }
  return `${base}${Date.now().toString().slice(-4)}`;
}

function buildProgramsFromBody(body) {
  // Supports either JSON string in programsJson OR form arrays programsProgram[] etc.
  const out = [];

  if (body && body.programsJson) {
    try {
      const arr = JSON.parse(body.programsJson);
      if (Array.isArray(arr)) {
        arr.forEach((x) => {
          const pid = safeObjId(x && x.program);
          if (!pid) return;
          out.push({
            program: pid,
            capacity: toInt(x && x.capacity, 0),
            isOpen: String(x && x.isOpen) !== "false",
            notes: cleanStr(x && x.notes),
          });
        });
      }
    } catch (e) {
      // ignore, fallback to arrays
    }
    return out;
  }

  const p = (body && body.program) ? body.program : [];
  const cap = (body && body.capacity) ? body.capacity : [];
  const open = (body && body.isOpen) ? body.isOpen : [];
  const notes = (body && body.pnotes) ? body.pnotes : [];

  const programs = Array.isArray(p) ? p : [p];
  const caps = Array.isArray(cap) ? cap : [cap];
  const opens = Array.isArray(open) ? open : [open];
  const notess = Array.isArray(notes) ? notes : [notes];

  for (let i = 0; i < programs.length; i++) {
    const pid = safeObjId(programs[i]);
    if (!pid) continue;
    out.push({
      program: pid,
      capacity: toInt(caps[i], 0),
      isOpen: String(opens[i]) !== "false",
      notes: cleanStr(notess[i]),
    });
  }

  return out;
}

module.exports = {
  // GET /admin/admissions/intakes
  async index(req, res) {
    try {
      const { Intake, Section, Applicant } = req.models;

      const q = cleanStr(req.query.q);
      const status = cleanStr(req.query.status);

      const filter = { isDeleted: { $ne: true } };
      if (q) {
        filter.$or = [
          { name: new RegExp(q, "i") },
          { code: new RegExp(q, "i") },
          { term: new RegExp(q, "i") },
        ];
      }
      if (status) filter.status = status;

      const items = await Intake.find(filter).sort({ isActive: -1, createdAt: -1 }).lean();
      const programs = await Section.find({ status: { $ne: "archived" } }).sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 }).lean();

      // Simple counts (optional). If Applicant uses string intake, we can count by intake code or name.
      // Recommended: add intakeId to Applicant later. For now: intake string field.
      let applicantCounts = {};
      if (Applicant) {
        const docs = await Applicant.find({ isDeleted: { $ne: true } }, { intake: 1 }).lean();
        docs.forEach((a) => {
          const key = (a && a.intake) ? String(a.intake) : "Unknown";
          applicantCounts[key] = (applicantCounts[key] || 0) + 1;
        });
      }

      const csrfToken = (typeof req.csrfToken === "function") ? req.csrfToken() : "";

      return res.render("tenant/intakes/index", {
        tenant: req.tenant,
        items,
        programs,
        applicantCounts,
        csrfToken,
        query: { q, status },
      });
    } catch (err) {
      console.error("[INTAKES:index]", err);
      return res.status(500).send("Failed to load intakes.");
    }
  },

  // GET /admin/admissions/intakes/new
  async newPage(req, res) {
    try {
      const { Section } = req.models;
      const programs = await Section.find({ status: { $ne: "archived" } }).sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 }).lean();
      const csrfToken = (typeof req.csrfToken === "function") ? req.csrfToken() : "";

      return res.render("tenant/intakes/new", {
        tenant: req.tenant,
        programs,
        csrfToken,
        error: null,
        form: null,
      });
    } catch (err) {
      console.error("[INTAKES:newPage]", err);
      return res.status(500).send("Failed to load create intake page.");
    }
  },

  // POST /admin/admissions/intakes
  async create(req, res) {
    try {
      const { Intake } = req.models;

      const name = cleanStr(req.body.name || req.body.termName || req.body.title);
      const year = req.body.year ? toInt(req.body.year, null) : null;
      const term = cleanStr(req.body.term || req.body.termName || name);
      const code = await buildUniqueTermCode(Intake, { name, term, year });
      const status = cleanStr(req.body.status) || "draft";

      const applicationOpenDate = parseDate(req.body.applicationOpenDate);
      const applicationCloseDate = parseDate(req.body.applicationCloseDate);
      const startDate = parseDate(req.body.startDate);
      const endDate = parseDate(req.body.endDate);

      const notes = cleanStr(req.body.notes);
      const programs = buildProgramsFromBody(req.body);

      if (!name || name.length < 2) return res.status(400).send("Term name is required.");

      const doc = await Intake.create({
        name,
        code,
        year,
        term,
        status: ["draft", "open", "closed", "archived"].includes(status) ? status : "draft",
        isActive: String(req.body.isActive) === "1" || String(req.body.isActive).toLowerCase() === "true",
        applicationOpenDate,
        applicationCloseDate,
        startDate,
        endDate,
        programs,
        notes,
        createdBy: req.user ? req.user._id : null,
        updatedBy: req.user ? req.user._id : null,
      });

      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:create]", err);
      // handle duplicate code
      if (String(err && err.code) === "11000") return res.status(400).send("Term code already exists. Retry.");
      return res.status(500).send("Failed to create term.");
    }
  },

  // GET /admin/admissions/intakes/:id/edit
  async editPage(req, res) {
    try {
      const { Intake, Section } = req.models;
      const id = req.params.id;

      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!item) return res.status(404).send("Intake not found.");

      const programs = await Section.find({ status: { $ne: "archived" } }).sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 }).lean();
      const csrfToken = (typeof req.csrfToken === "function") ? req.csrfToken() : "";

      return res.render("tenant/intakes/edit", {
        tenant: req.tenant,
        item,
        programs,
        csrfToken,
        error: null,
      });
    } catch (err) {
      console.error("[INTAKES:editPage]", err);
      return res.status(500).send("Failed to load edit intake page.");
    }
  },

  // POST /admin/admissions/intakes/:id
  async update(req, res) {
    try {
      const { Intake } = req.models;
      const id = req.params.id;

      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!item) return res.status(404).send("Intake not found.");

      const name = cleanStr(req.body.name || req.body.termName || req.body.title);
      const year = req.body.year ? toInt(req.body.year, null) : null;
      const term = cleanStr(req.body.term || req.body.termName || name);
      const status = cleanStr(req.body.status) || item.status;

      const applicationOpenDate = parseDate(req.body.applicationOpenDate);
      const applicationCloseDate = parseDate(req.body.applicationCloseDate);
      const startDate = parseDate(req.body.startDate);
      const endDate = parseDate(req.body.endDate);

      const notes = cleanStr(req.body.notes);
      const programs = buildProgramsFromBody(req.body);

      if (!name || name.length < 2) return res.status(400).send("Term name is required.");

      item.name = name;
      item.code = item.code || await buildUniqueTermCode(Intake, { name, term, year, excludeId: item._id });
      item.year = year;
      item.term = term;
      item.status = ["draft", "open", "closed", "archived"].includes(status) ? status : item.status;

      item.applicationOpenDate = applicationOpenDate;
      item.applicationCloseDate = applicationCloseDate;
      item.startDate = startDate;
      item.endDate = endDate;

      item.programs = programs;
      item.notes = notes;
      item.updatedBy = req.user ? req.user._id : null;

      await item.save();

      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:update]", err);
      if (String(err && err.code) === "11000") return res.status(400).send("Term code already exists. Retry.");
      return res.status(500).send("Failed to update term.");
    }
  },

  // POST /admin/admissions/intakes/:id/active
  async setActive(req, res) {
    try {
      const { Intake } = req.models;
      const id = req.params.id;

      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!item) return res.status(404).send("Intake not found.");

      // make only one active
      await Intake.updateMany({ isDeleted: { $ne: true }, isActive: true }, { $set: { isActive: false } });
      item.isActive = true;
      item.updatedBy = req.user ? req.user._id : null;
      await item.save();

      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:setActive]", err);
      return res.status(500).send("Failed to set active intake.");
    }
  },

  // POST /admin/admissions/intakes/:id/status
  async setStatus(req, res) {
    try {
      const { Intake } = req.models;
      const id = req.params.id;

      const next = cleanStr(req.body.status);
      if (!["draft", "open", "closed", "archived"].includes(next)) return res.status(400).send("Invalid status.");

      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!item) return res.status(404).send("Intake not found.");

      item.status = next;
      item.updatedBy = req.user ? req.user._id : null;
      await item.save();

      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:setStatus]", err);
      return res.status(500).send("Failed to change intake status.");
    }
  },

  // POST /admin/admissions/intakes/:id/delete
  async remove(req, res) {
    try {
      const { Intake } = req.models;
      const id = req.params.id;

      const item = await Intake.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!item) return res.status(404).send("Intake not found.");

      item.isDeleted = true;
      item.deletedAt = new Date();
      item.isActive = false;
      item.updatedBy = req.user ? req.user._id : null;
      await item.save();

      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:remove]", err);
      return res.status(500).send("Failed to delete intake.");
    }
  },

  async importCsv(req, res) {
    try {
      const { Intake } = req.models;
      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "Please choose a CSV file.");
        return res.redirect("/admin/admissions/intakes");
      }

      const text = req.file.buffer.toString("utf8");
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        req.flash?.("error", "CSV file is empty.");
        return res.redirect("/admin/admissions/intakes");
      }

      const headers = lines.shift().split(",").map((h) => cleanStr(h).toLowerCase());
      const idx = (name) => headers.indexOf(name.toLowerCase());
      let added = 0;
      let skipped = 0;

      for (const line of lines.slice(0, 500)) {
        const cols = line.split(",");
        const name = cleanStr(cols[idx("name")]);
        const code = cleanUpper(cols[idx("code")]);
        if (!name || !code) {
          skipped += 1;
          continue;
        }

        const exists = await Intake.findOne({ code, isDeleted: { $ne: true } }).select("_id").lean();
        if (exists) {
          skipped += 1;
          continue;
        }

        await Intake.create({
          name,
          code,
          status: cleanStr(cols[idx("status")]) || "draft",
          applicationOpenDate: parseDate(cols[idx("applicationopendate")]),
          applicationCloseDate: parseDate(cols[idx("applicationclosedate")]),
          startDate: parseDate(cols[idx("startdate")]),
          endDate: parseDate(cols[idx("enddate")]),
          isActive: ["1", "true", "yes"].includes(cleanStr(cols[idx("isactive")]).toLowerCase()),
          programs: [],
          createdBy: req.user ? req.user._id : null,
          updatedBy: req.user ? req.user._id : null,
        });
        added += 1;
      }

      req.flash?.("success", `Import completed. Added ${added} term(s).`);
      if (skipped) req.flash?.("error", `${skipped} row(s) skipped.`);
      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:importCsv]", err);
      req.flash?.("error", "Failed to import terms.");
      return res.redirect("/admin/admissions/intakes");
    }
  },

  async bulkStatus(req, res) {
    try {
      const { Intake } = req.models;
      const ids = cleanStr(req.body.ids).split(",").map(safeObjId).filter(Boolean);
      const status = cleanStr(req.body.status);
      if (!ids.length || !["draft", "open", "closed", "archived"].includes(status)) {
        req.flash?.("error", "Select intakes and a valid status.");
        return res.redirect("/admin/admissions/intakes");
      }

      await Intake.updateMany({ _id: { $in: ids }, isDeleted: { $ne: true } }, { $set: { status, updatedBy: req.user ? req.user._id : null } });
      req.flash?.("success", "Selected intakes updated.");
      return res.redirect("/admin/admissions/intakes");
    } catch (err) {
      console.error("[INTAKES:bulkStatus]", err);
      req.flash?.("error", "Bulk status update failed.");
      return res.redirect("/admin/admissions/intakes");
    }
  },
};
