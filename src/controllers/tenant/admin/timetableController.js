const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toMinutes(hhmm) {
  const s = String(hhmm || "").trim();
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return hh * 60 + mm;
}

function safeStr(v, max = 120) {
  return String(v || "").trim().slice(0, max);
}

function isObjId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || ""));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
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

const timetableRules = [
  body("classGroup").custom(isObjId).withMessage("Class is required."),
  body("subject").custom(isObjId).withMessage("Subject is required."),
  body("teacher").optional({ checkFalsy: true }).custom((v) => !v || isObjId(v)).withMessage("Invalid teacher."),
  body("academicYear").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("term").optional({ checkFalsy: true }).isInt({ min: 1, max: 3 }).toInt(),
  body("dayOfWeek").isIn(DAYS).withMessage("Invalid day."),
  body("startTime").custom((v) => toMinutes(v) !== null).withMessage("Invalid start time (HH:MM)."),
  body("endTime").custom((v) => toMinutes(v) !== null).withMessage("Invalid end time (HH:MM)."),
  body("weekPattern").optional({ checkFalsy: true }).isIn(["all", "odd", "even"]).withMessage("Invalid week pattern."),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("campus").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("status").optional({ checkFalsy: true }).isIn(["active", "inactive", "archived"]).withMessage("Invalid status."),
  body("note").optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
];

async function findConflicts({
  TimetableEntry,
  excludeId,
  dayOfWeek,
  startMin,
  endMin,
  academicYear,
  term,
  classGroup,
  teacher,
  room,
}) {
  const base = {
    dayOfWeek,
    academicYear: academicYear || "",
    term: Number.isFinite(term) ? term : 1,
    status: { $ne: "archived" },
  };

  if (excludeId) base._id = { $ne: excludeId };

  const conflicts = [];

  const classItems = await TimetableEntry.find({ ...base, classGroup })
    .select("startMinutes endMinutes subject teacher room")
    .populate("subject", "code title")
    .populate("teacher", "fullName name")
    .lean();

  const classConflict = classItems.find((x) => overlaps(startMin, endMin, x.startMinutes, x.endMinutes));
  if (classConflict) conflicts.push({ type: "Class conflict", item: classConflict });

  if (teacher) {
    const teacherItems = await TimetableEntry.find({ ...base, teacher })
      .select("startMinutes endMinutes classGroup subject room")
      .populate("subject", "code title")
      .populate("classGroup", "name code")
      .lean();

    const teacherConflict = teacherItems.find((x) => overlaps(startMin, endMin, x.startMinutes, x.endMinutes));
    if (teacherConflict) conflicts.push({ type: "Teacher conflict", item: teacherConflict });
  }

  if (room) {
    const roomItems = await TimetableEntry.find({ ...base, room })
      .select("startMinutes endMinutes classGroup subject teacher")
      .populate("subject", "code title")
      .populate("classGroup", "name code")
      .lean();

    const roomConflict = roomItems.find((x) => overlaps(startMin, endMin, x.startMinutes, x.endMinutes));
    if (roomConflict) conflicts.push({ type: "Room conflict", item: roomConflict });
  }

  return conflicts;
}

module.exports = {
  timetableRules,

  list: async (req, res) => {
    try {
      const { TimetableEntry, Class, Subject, Staff } = req.models;

      const q = safeStr(req.query.q, 120);
      const academicYear = safeStr(req.query.academicYear, 20);
      const term = safeStr(req.query.term, 6);
      const classGroup = safeStr(req.query.classGroup, 50);
      const teacher = safeStr(req.query.teacher, 50);
      const dayOfWeek = safeStr(req.query.dayOfWeek, 10);
      const status = safeStr(req.query.status, 20);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (academicYear) filter.academicYear = academicYear;
      if (term && !Number.isNaN(Number(term))) filter.term = Number(term);
      if (dayOfWeek && DAYS.includes(dayOfWeek)) filter.dayOfWeek = dayOfWeek;
      if (classGroup && isObjId(classGroup)) filter.classGroup = classGroup;
      if (teacher && isObjId(teacher)) filter.teacher = teacher;
      if (["active", "inactive", "archived"].includes(status)) filter.status = status;

      if (q) {
        filter.$or = [
          { room: { $regex: q, $options: "i" } },
          { campus: { $regex: q, $options: "i" } },
          { note: { $regex: q, $options: "i" } },
        ];
      }

      const total = await TimetableEntry.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const entries = await TimetableEntry.find(filter)
        .populate("classGroup", "name code schoolLevel classLevel stream")
        .populate("subject", "title code shortTitle")
        .populate("teacher", "fullName name role email")
        .sort({ dayOfWeek: 1, startMinutes: 1, createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = await Class.find({})
        .select("name code schoolLevel classLevel stream")
        .sort({ name: 1 })
        .lean();

      const subjects = await Subject.find({})
        .select("title code shortTitle schoolLevel")
        .sort({ title: 1 })
        .lean();

      const staffList = await Staff.find({})
        .select("fullName name role email")
        .sort({ fullName: 1, name: 1 })
        .lean();

      const academicYears = (await TimetableEntry.distinct("academicYear")).filter(Boolean).sort();

      const kpis = {
        total,
        active: await TimetableEntry.countDocuments({ ...filter, status: "active" }),
        inactive: await TimetableEntry.countDocuments({ ...filter, status: "inactive" }),
        archived: await TimetableEntry.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/timetable/index", {
        tenant: req.tenant || null,
        entries,
        classes,
        subjects,
        staffList,
        academicYears,
        days: DAYS,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          academicYear,
          term,
          classGroup,
          teacher,
          dayOfWeek,
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
      console.error("TIMETABLE LIST ERROR:", err);
      return res.status(500).send("Failed to load timetable.");
    }
  },

  create: async (req, res) => {
    const { TimetableEntry } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/tenant/timetable");
    }

    try {
      const startMin = toMinutes(req.body.startTime);
      const endMin = toMinutes(req.body.endTime);

      if (startMin === null || endMin === null || endMin <= startMin) {
        req.flash?.("error", "End time must be later than start time.");
        return res.redirect("/tenant/timetable");
      }

      const doc = {
        academicYear: safeStr(req.body.academicYear, 20),
        term: Math.max(1, Math.min(Number(req.body.term || 1), 3)),
        classGroup: req.body.classGroup,
        subject: req.body.subject,
        teacher: req.body.teacher && isObjId(req.body.teacher) ? req.body.teacher : null,
        room: safeStr(req.body.room, 60),
        campus: safeStr(req.body.campus, 80),
        dayOfWeek: req.body.dayOfWeek,
        startTime: safeStr(req.body.startTime, 5),
        endTime: safeStr(req.body.endTime, 5),
        startMinutes: startMin,
        endMinutes: endMin,
        weekPattern: ["all", "odd", "even"].includes(req.body.weekPattern) ? req.body.weekPattern : "all",
        status: ["active", "inactive", "archived"].includes(req.body.status) ? req.body.status : "active",
        note: safeStr(req.body.note, 500),
        createdBy: req.user?._id || null,
      };

      const conflicts = await findConflicts({
        TimetableEntry,
        excludeId: null,
        dayOfWeek: doc.dayOfWeek,
        startMin: doc.startMinutes,
        endMin: doc.endMinutes,
        academicYear: doc.academicYear,
        term: doc.term,
        classGroup: doc.classGroup,
        teacher: doc.teacher,
        room: doc.room,
      });

      if (conflicts.length) {
        const msg = conflicts
          .map((c) => `${c.type} (${c.item?.subject?.code || "Subject"} ${c.item?.startMinutes}-${c.item?.endMinutes})`)
          .join(" | ");
        req.flash?.("error", `Schedule conflict detected: ${msg}`);
        return res.redirect("/tenant/timetable");
      }

      await TimetableEntry.create(doc);

      req.flash?.("success", "Timetable entry created.");
      return res.redirect("/tenant/timetable");
    } catch (err) {
      console.error("CREATE TIMETABLE ERROR:", err);
      req.flash?.("error", "Failed to create timetable entry.");
      return res.redirect("/tenant/timetable");
    }
  },

  update: async (req, res) => {
    const { TimetableEntry } = req.models;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/tenant/timetable");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid timetable entry id.");
        return res.redirect("/tenant/timetable");
      }

      const startMin = toMinutes(req.body.startTime);
      const endMin = toMinutes(req.body.endTime);

      if (startMin === null || endMin === null || endMin <= startMin) {
        req.flash?.("error", "End time must be later than start time.");
        return res.redirect("/tenant/timetable");
      }

      const update = {
        academicYear: safeStr(req.body.academicYear, 20),
        term: Math.max(1, Math.min(Number(req.body.term || 1), 3)),
        classGroup: req.body.classGroup,
        subject: req.body.subject,
        teacher: req.body.teacher && isObjId(req.body.teacher) ? req.body.teacher : null,
        room: safeStr(req.body.room, 60),
        campus: safeStr(req.body.campus, 80),
        dayOfWeek: req.body.dayOfWeek,
        startTime: safeStr(req.body.startTime, 5),
        endTime: safeStr(req.body.endTime, 5),
        startMinutes: startMin,
        endMinutes: endMin,
        weekPattern: ["all", "odd", "even"].includes(req.body.weekPattern) ? req.body.weekPattern : "all",
        status: ["active", "inactive", "archived"].includes(req.body.status) ? req.body.status : "active",
        note: safeStr(req.body.note, 500),
      };

      const conflicts = await findConflicts({
        TimetableEntry,
        excludeId: id,
        dayOfWeek: update.dayOfWeek,
        startMin: update.startMinutes,
        endMin: update.endMinutes,
        academicYear: update.academicYear,
        term: update.term,
        classGroup: update.classGroup,
        teacher: update.teacher,
        room: update.room,
      });

      if (conflicts.length) {
        const msg = conflicts
          .map((c) => `${c.type} (${c.item?.subject?.code || "Subject"} ${c.item?.startMinutes}-${c.item?.endMinutes})`)
          .join(" | ");
        req.flash?.("error", `Schedule conflict detected: ${msg}`);
        return res.redirect("/tenant/timetable");
      }

      await TimetableEntry.updateOne({ _id: id }, { $set: update }, { runValidators: true });

      req.flash?.("success", "Timetable entry updated.");
      return res.redirect("/tenant/timetable");
    } catch (err) {
      console.error("UPDATE TIMETABLE ERROR:", err);
      req.flash?.("error", "Failed to update timetable entry.");
      return res.redirect("/tenant/timetable");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { TimetableEntry } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid timetable entry id.");
        return res.redirect("/tenant/timetable");
      }

      const next = ["active", "inactive", "archived"].includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/tenant/timetable");
      }

      await TimetableEntry.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Status updated.");
      return res.redirect("/tenant/timetable");
    } catch (err) {
      console.error("SET TIMETABLE STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/tenant/timetable");
    }
  },

  remove: async (req, res) => {
    try {
      const { TimetableEntry } = req.models;
      const id = String(req.params.id || "").trim();

      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid timetable entry id.");
        return res.redirect("/tenant/timetable");
      }

      await TimetableEntry.deleteOne({ _id: id });
      req.flash?.("success", "Timetable entry deleted.");
      return res.redirect("/tenant/timetable");
    } catch (err) {
      console.error("DELETE TIMETABLE ERROR:", err);
      req.flash?.("error", "Failed to delete timetable entry.");
      return res.redirect("/tenant/timetable");
    }
  },

  bulk: async (req, res) => {
    try {
      const { TimetableEntry } = req.models;

      const action = safeStr(req.body.action, 20);
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No timetable items selected.");
        return res.redirect("/tenant/timetable");
      }

      if (action === "activate") {
        await TimetableEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        req.flash?.("success", "Selected items activated.");
      } else if (action === "deactivate") {
        await TimetableEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "inactive" } });
        req.flash?.("success", "Selected items deactivated.");
      } else if (action === "archive") {
        await TimetableEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected items archived.");
      } else if (action === "delete") {
        await TimetableEntry.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected items deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/tenant/timetable");
    } catch (err) {
      console.error("TIMETABLE BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/tenant/timetable");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { TimetableEntry, Class, Subject, Staff } = req.models;

      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/tenant/timetable");
      }

      const raw = String(req.file.buffer.toString("utf8") || "").replace(/^\uFEFF/, "");
      const rows = parseCsv(raw);

      if (!rows.length) {
        req.flash?.("error", "CSV file is empty.");
        return res.redirect("/tenant/timetable");
      }

      const headers = rows[0].map((h) => String(h || "").trim());
      const bodyRows = rows.slice(1);

      const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

      const iClassCode = idx("classCode");
      const iSubjectCode = idx("subjectCode");
      const iDay = idx("dayOfWeek");
      const iStart = idx("startTime");
      const iEnd = idx("endTime");
      const iAY = idx("academicYear");
      const iTerm = idx("term");
      const iTeacherEmail = idx("teacherEmail");
      const iRoom = idx("room");
      const iCampus = idx("campus");
      const iWeek = idx("weekPattern");
      const iStatus = idx("status");
      const iNote = idx("note");

      if ([iClassCode, iSubjectCode, iDay, iStart, iEnd].some((x) => x === -1)) {
        req.flash?.("error", "CSV must include classCode, subjectCode, dayOfWeek, startTime, endTime.");
        return res.redirect("/tenant/timetable");
      }

      const classes = await Class.find({}).select("_id code name").lean();
      const subjects = await Subject.find({}).select("_id code title").lean();
      const staff = await Staff.find({}).select("_id email").lean();

      const classByCode = new Map(classes.filter((x) => x.code).map((x) => [String(x.code).trim().toUpperCase(), String(x._id)]));
      const subjectByCode = new Map(subjects.filter((x) => x.code).map((x) => [String(x.code).trim().toUpperCase(), String(x._id)]));
      const staffByEmail = new Map(staff.filter((x) => x.email).map((x) => [String(x.email).trim().toLowerCase(), String(x._id)]));

      let created = 0;
      let skipped = 0;

      for (const row of bodyRows.slice(0, 3000)) {
        const classCode = String(row[iClassCode] || "").trim().toUpperCase();
        const subjectCode = String(row[iSubjectCode] || "").trim().toUpperCase();
        const dayOfWeek = String(row[iDay] || "").trim();
        const startTime = String(row[iStart] || "").trim();
        const endTime = String(row[iEnd] || "").trim();

        const classId = classByCode.get(classCode);
        const subjectId = subjectByCode.get(subjectCode);
        const startMin = toMinutes(startTime);
        const endMin = toMinutes(endTime);

        if (!classId || !subjectId || !DAYS.includes(dayOfWeek) || startMin === null || endMin === null || endMin <= startMin) {
          skipped += 1;
          continue;
        }

        const teacherEmail = iTeacherEmail >= 0 ? String(row[iTeacherEmail] || "").trim().toLowerCase() : "";
        const teacherId = teacherEmail && staffByEmail.has(teacherEmail) ? staffByEmail.get(teacherEmail) : null;

        const doc = {
          classGroup: classId,
          subject: subjectId,
          teacher: teacherId,
          dayOfWeek,
          startTime,
          endTime,
          startMinutes: startMin,
          endMinutes: endMin,
          academicYear: iAY >= 0 ? safeStr(row[iAY], 20) : "",
          term: iTerm >= 0 ? Math.max(1, Math.min(Number(row[iTerm] || 1), 3)) : 1,
          room: iRoom >= 0 ? safeStr(row[iRoom], 60) : "",
          campus: iCampus >= 0 ? safeStr(row[iCampus], 80) : "",
          weekPattern: iWeek >= 0 && ["all", "odd", "even"].includes(String(row[iWeek] || "").trim()) ? String(row[iWeek]).trim() : "all",
          status: iStatus >= 0 && ["active", "inactive", "archived"].includes(String(row[iStatus] || "").trim()) ? String(row[iStatus]).trim() : "active",
          note: iNote >= 0 ? safeStr(row[iNote], 500) : "",
          createdBy: req.user?._id || null,
        };

        const conflicts = await findConflicts({
          TimetableEntry,
          excludeId: null,
          dayOfWeek: doc.dayOfWeek,
          startMin: doc.startMinutes,
          endMin: doc.endMinutes,
          academicYear: doc.academicYear,
          term: doc.term,
          classGroup: doc.classGroup,
          teacher: doc.teacher,
          room: doc.room,
        });

        if (conflicts.length) {
          skipped += 1;
          continue;
        }

        try {
          await TimetableEntry.create(doc);
          created += 1;
        } catch {
          skipped += 1;
        }
      }

      req.flash?.("success", `Import completed. Created ${created}, skipped ${skipped}.`);
      return res.redirect("/tenant/timetable");
    } catch (err) {
      console.error("IMPORT TIMETABLE CSV ERROR:", err);
      req.flash?.("error", "Failed to import CSV.");
      return res.redirect("/tenant/timetable");
    }
  },
};