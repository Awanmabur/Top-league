const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

function toMinutes(hhmm) {
  const s = String(hhmm || "").trim();
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
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

  for (let i = 0; i < text.length; i++) {
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
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => safeStr(h, 80));

  return rows.slice(1).filter((r) => r.some((x) => String(x || "").trim())).map((r) => {
    const out = {};
    headers.forEach((h, idx) => {
      out[h] = r[idx] ?? "";
    });
    return out;
  });
}

const parsePapers = (reqBody) => {
  const names = reqBody["papers_name[]"] ?? reqBody.papers_name ?? [];
  const marks = reqBody["papers_marks[]"] ?? reqBody.papers_marks ?? [];
  const durs = reqBody["papers_duration[]"] ?? reqBody.papers_duration ?? [];

  const arrNames = Array.isArray(names) ? names : (names ? [names] : []);
  const arrMarks = Array.isArray(marks) ? marks : (marks ? [marks] : []);
  const arrDurs = Array.isArray(durs) ? durs : (durs ? [durs] : []);

  const papers = [];
  const n = Math.max(arrNames.length, arrMarks.length, arrDurs.length);

  for (let i = 0; i < n; i++) {
    const rawName = safeStr(arrNames[i], 60);
    const mk = Math.max(0, Math.min(Number(arrMarks[i] || 0), 100000));
    const du = Math.max(0, Math.min(Number(arrDurs[i] || 0), 1440));
    if (!rawName && mk === 0 && du === 0) continue;
    papers.push({ name: rawName || `Paper ${i + 1}`, marks: mk, durationMinutes: du });
  }

  return papers.slice(0, 10);
};

const examRules = [
  body("title").trim().isLength({ min: 2, max: 120 }).withMessage("Exam title is required (2-120 chars)."),
  body("examType").optional({ checkFalsy: true }).isIn(["midterm", "final", "quiz", "test", "mock", "practical", "other"]).withMessage("Invalid exam type."),
  body("academicYear").optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body("semester").optional({ checkFalsy: true }).isInt({ min: 1, max: 6 }).toInt(),
  body("classGroup").custom(isObjId).withMessage("Class is required."),
  body("program").optional({ checkFalsy: true }).custom((v) => !v || isObjId(v)).withMessage("Invalid program."),
  body("course").custom(isObjId).withMessage("Course is required."),
  body("invigilator").optional({ checkFalsy: true }).custom((v) => !v || isObjId(v)).withMessage("Invalid invigilator."),
  body("date").custom((v) => !Number.isNaN(Date.parse(v))).withMessage("Valid exam date is required."),
  body("startTime").custom((v) => toMinutes(v) !== null).withMessage("Invalid start time (HH:MM)."),
  body("endTime").custom((v) => toMinutes(v) !== null).withMessage("Invalid end time (HH:MM)."),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body("campus").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("instructions").optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  body("totalMarks").optional({ checkFalsy: true }).isFloat({ min: 0, max: 100000 }).toFloat(),
  body("passMark").optional({ checkFalsy: true }).isFloat({ min: 0, max: 100000 }).toFloat(),
  body("status").optional({ checkFalsy: true }).isIn(["scheduled", "ongoing", "completed", "archived"]).withMessage("Invalid status."),
];

async function findConflicts({ Exam, excludeId, dateKey, startMin, endMin, academicYear, semester, classGroup, invigilator, room }) {
  const base = {
    academicYear: academicYear || "",
    semester: Number.isFinite(semester) ? semester : 1,
    dateKey,
    status: { $ne: "archived" },
  };
  if (excludeId) base._id = { $ne: excludeId };

  const conflicts = [];

  const classItems = await Exam.find({ ...base, classGroup }).select("startMinutes endMinutes course room").populate("course", "code title").lean();
  const cHit = classItems.find((x) => overlaps(startMin, endMin, x.startMinutes, x.endMinutes));
  if (cHit) conflicts.push({ type: "Class conflict", item: cHit });

  if (invigilator) {
    const invItems = await Exam.find({ ...base, invigilator }).select("startMinutes endMinutes classGroup course room").populate("course", "code title").populate("classGroup", "name code").lean();
    const iHit = invItems.find((x) => overlaps(startMin, endMin, x.startMinutes, x.endMinutes));
    if (iHit) conflicts.push({ type: "Invigilator conflict", item: iHit });
  }

  if (room) {
    const roomItems = await Exam.find({ ...base, room }).select("startMinutes endMinutes classGroup course invigilator").populate("course", "code title").populate("classGroup", "name code").lean();
    const rHit = roomItems.find((x) => overlaps(startMin, endMin, x.startMinutes, x.endMinutes));
    if (rHit) conflicts.push({ type: "Room conflict", item: rHit });
  }

  return conflicts;
}

function buildExamDoc(body, userId) {
  const startMin = toMinutes(body.startTime);
  const endMin = toMinutes(body.endTime);
  if (startMin === null || endMin === null || endMin <= startMin) {
    throw new Error("End time must be later than start time.");
  }

  const dt = new Date(body.date);
  const dateKey = dt.toISOString().slice(0, 10);

  return {
    title: safeStr(body.title, 120),
    examType: ["midterm", "final", "quiz", "test", "mock", "practical", "other"].includes(body.examType) ? body.examType : "final",
    academicYear: safeStr(body.academicYear, 20),
    semester: Math.max(1, Math.min(Number(body.semester || 1), 6)),
    classGroup: body.classGroup,
    program: body.program && isObjId(body.program) ? body.program : null,
    course: body.course,
    date: dt,
    dateKey,
    startTime: safeStr(body.startTime, 5),
    endTime: safeStr(body.endTime, 5),
    startMinutes: startMin,
    endMinutes: endMin,
    durationMinutes: Math.max(1, Math.min(Number(body.durationMinutes || (endMin - startMin)), 1440)),
    room: safeStr(body.room, 60),
    campus: safeStr(body.campus, 80),
    invigilator: body.invigilator && isObjId(body.invigilator) ? body.invigilator : null,
    instructions: safeStr(body.instructions, 2000),
    totalMarks: Math.max(0, Math.min(Number(body.totalMarks || 100), 100000)),
    passMark: Math.max(0, Math.min(Number(body.passMark || 50), 100000)),
    status: ["scheduled", "ongoing", "completed", "archived"].includes(body.status) ? body.status : "scheduled",
    papers: parsePapers(body),
    createdBy: userId || null,
  };
}

module.exports = {
  examRules,

  list: async (req, res) => {
    try {
      const { Exam, Class, Course, Program, Staff } = req.models;

      const q = safeStr(req.query.q, 120);
      const academicYear = safeStr(req.query.academicYear, 20);
      const semester = safeStr(req.query.semester, 6);
      const classGroup = safeStr(req.query.classGroup, 50);
      const course = safeStr(req.query.course, 50);
      const status = safeStr(req.query.status, 20);
      const examType = safeStr(req.query.examType, 20);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      const filter = {};
      if (academicYear) filter.academicYear = academicYear;
      if (semester && !Number.isNaN(Number(semester))) filter.semester = Number(semester);
      if (classGroup && isObjId(classGroup)) filter.classGroup = classGroup;
      if (course && isObjId(course)) filter.course = course;
      if (status && ["scheduled", "ongoing", "completed", "archived"].includes(status)) filter.status = status;
      if (examType && ["midterm", "final", "quiz", "test", "mock", "practical", "other"].includes(examType)) filter.examType = examType;

      if (q) {
        filter.$or = [
          { title: { $regex: q, $options: "i" } },
          { room: { $regex: q, $options: "i" } },
          { campus: { $regex: q, $options: "i" } },
        ];
      }

      const total = await Exam.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const exams = await Exam.find(filter)
        .populate("classGroup", "name code yearOfStudy semester section")
        .populate("course", "title code")
        .populate("program", "name code")
        .populate("invigilator", "fullName name role")
        .sort({ date: 1, startMinutes: 1, createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = await Class.find({}).select("name code").sort({ name: 1 }).lean();
      const courses = await Course.find({}).select("title code").sort({ title: 1 }).lean();
      const programs = await Program.find({}).select("name code").sort({ name: 1 }).lean();
      const staffList = await Staff.find({}).select("fullName name role").sort({ fullName: 1, name: 1 }).lean();
      const academicYears = (await Exam.distinct("academicYear")).filter(Boolean).sort();

      const kpis = {
        total,
        scheduled: await Exam.countDocuments({ ...filter, status: "scheduled" }),
        ongoing: await Exam.countDocuments({ ...filter, status: "ongoing" }),
        completed: await Exam.countDocuments({ ...filter, status: "completed" }),
        archived: await Exam.countDocuments({ ...filter, status: "archived" }),
      };

      return res.render("tenant/admin/exams/index", {
        tenant: req.tenant || null,
        exams,
        classes,
        courses,
        programs,
        staffList,
        academicYears,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: { q, academicYear, semester, classGroup, course, status, examType, page: safePage, total, totalPages, perPage },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("EXAMS LIST ERROR:", err);
      return res.status(500).send("Failed to load exams.");
    }
  },

  create: async (req, res) => {
    const { Exam } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/exams");
    }

    try {
      const doc = buildExamDoc(req.body, req.user?._id || null);
      const conflicts = await findConflicts({
        Exam,
        excludeId: null,
        dateKey: doc.dateKey,
        startMin: doc.startMinutes,
        endMin: doc.endMinutes,
        academicYear: doc.academicYear,
        semester: doc.semester,
        classGroup: doc.classGroup,
        invigilator: doc.invigilator,
        room: doc.room,
      });

      if (conflicts.length) {
        req.flash?.("error", "Exam conflict detected: " + conflicts.map((c) => c.type).join(" | "));
        return res.redirect("/admin/exams");
      }

      await Exam.create(doc);
      req.flash?.("success", "Exam scheduled.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("CREATE EXAM ERROR:", err);
      req.flash?.("error", err.message || "Failed to schedule exam.");
      return res.redirect("/admin/exams");
    }
  },

  update: async (req, res) => {
    const { Exam } = req.models;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/exams");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid exam id.");
        return res.redirect("/admin/exams");
      }

      const update = buildExamDoc(req.body, null);
      delete update.createdBy;

      const conflicts = await findConflicts({
        Exam,
        excludeId: id,
        dateKey: update.dateKey,
        startMin: update.startMinutes,
        endMin: update.endMinutes,
        academicYear: update.academicYear,
        semester: update.semester,
        classGroup: update.classGroup,
        invigilator: update.invigilator,
        room: update.room,
      });

      if (conflicts.length) {
        req.flash?.("error", "Exam conflict detected: " + conflicts.map((c) => c.type).join(" | "));
        return res.redirect("/admin/exams");
      }

      await Exam.updateOne({ _id: id }, { $set: update }, { runValidators: true });
      req.flash?.("success", "Exam updated.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("UPDATE EXAM ERROR:", err);
      req.flash?.("error", err.message || "Failed to update exam.");
      return res.redirect("/admin/exams");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Exam } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid exam id.");
        return res.redirect("/admin/exams");
      }

      const next = ["scheduled", "ongoing", "completed", "archived"].includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/exams");
      }

      await Exam.updateOne({ _id: id }, { $set: { status: next } });
      req.flash?.("success", "Status updated.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("SET EXAM STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/exams");
    }
  },

  remove: async (req, res) => {
    try {
      const { Exam } = req.models;
      const id = String(req.params.id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash?.("error", "Invalid exam id.");
        return res.redirect("/admin/exams");
      }

      await Exam.deleteOne({ _id: id });
      req.flash?.("success", "Exam deleted.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("DELETE EXAM ERROR:", err);
      req.flash?.("error", "Failed to delete exam.");
      return res.redirect("/admin/exams");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Exam } = req.models;
      const action = safeStr(req.body.action, 20);
      const ids = String(req.body.ids || "").split(",").map((x) => x.trim()).filter((x) => mongoose.Types.ObjectId.isValid(x));

      if (!ids.length) {
        req.flash?.("error", "No exams selected.");
        return res.redirect("/admin/exams");
      }

      if (action === "archive") {
        await Exam.updateMany({ _id: { $in: ids } }, { $set: { status: "archived" } });
        req.flash?.("success", "Selected exams archived.");
      } else if (action === "delete") {
        await Exam.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected exams deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAMS BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/exams");
    }
  },

  exportCsv: async (req, res) => {
    try {
      const { Exam } = req.models;
      const exams = await Exam.find({})
        .populate("classGroup", "name")
        .populate("course", "code title")
        .populate("program", "name")
        .populate("invigilator", "fullName name")
        .sort({ date: 1, startMinutes: 1 })
        .lean();

      const esc = (value) => {
        const s = String(value ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const rows = [
        ["title","examType","academicYear","semester","classGroupId","className","courseId","courseCode","courseTitle","programId","programName","date","startTime","endTime","room","campus","invigilatorId","invigilatorName","totalMarks","passMark","status","instructions"],
        ...exams.map((x) => [
          x.title || "",
          x.examType || "",
          x.academicYear || "",
          x.semester || 1,
          x.classGroup?._id || x.classGroup || "",
          x.classGroup?.name || "",
          x.course?._id || x.course || "",
          x.course?.code || "",
          x.course?.title || "",
          x.program?._id || x.program || "",
          x.program?.name || "",
          x.dateKey || (x.date ? new Date(x.date).toISOString().slice(0, 10) : ""),
          x.startTime || "",
          x.endTime || "",
          x.room || "",
          x.campus || "",
          x.invigilator?._id || x.invigilator || "",
          x.invigilator?.fullName || x.invigilator?.name || "",
          x.totalMarks || 100,
          x.passMark || 50,
          x.status || "scheduled",
          x.instructions || "",
        ]),
      ];

      const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="exams-export.csv"');
      return res.send(csv);
    } catch (err) {
      console.error("EXPORT EXAMS ERROR:", err);
      req.flash?.("error", "Failed to export exams.");
      return res.redirect("/admin/exams");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Exam } = req.models;
      const file = req.file;
      if (!file || !file.buffer) {
        req.flash?.("error", "CSV file is required.");
        return res.redirect("/admin/exams");
      }

      const rows = parseCsv(file.buffer.toString("utf8"));
      if (!rows.length) {
        req.flash?.("error", "CSV has no importable rows.");
        return res.redirect("/admin/exams");
      }

      let created = 0;
      let skipped = 0;

      for (const row of rows) {
        try {
          if (!row.title || !row.classGroupId || !row.courseId || !row.date || !row.startTime || !row.endTime) {
            skipped += 1;
            continue;
          }

          const body = {
            title: row.title,
            examType: row.examType,
            academicYear: row.academicYear,
            semester: row.semester,
            classGroup: row.classGroupId,
            course: row.courseId,
            program: row.programId,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
            room: row.room,
            campus: row.campus,
            invigilator: row.invigilatorId,
            totalMarks: row.totalMarks,
            passMark: row.passMark,
            status: row.status,
            instructions: row.instructions,
            durationMinutes: row.durationMinutes,
          };

          const doc = buildExamDoc(body, req.user?._id || null);
          const conflicts = await findConflicts({
            Exam,
            excludeId: null,
            dateKey: doc.dateKey,
            startMin: doc.startMinutes,
            endMin: doc.endMinutes,
            academicYear: doc.academicYear,
            semester: doc.semester,
            classGroup: doc.classGroup,
            invigilator: doc.invigilator,
            room: doc.room,
          });

          if (conflicts.length) {
            skipped += 1;
            continue;
          }

          await Exam.create(doc);
          created += 1;
        } catch {
          skipped += 1;
        }
      }

      req.flash?.("success", `Import complete. Created ${created}, skipped ${skipped}.`);
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("IMPORT EXAMS ERROR:", err);
      req.flash?.("error", "Failed to import exams CSV.");
      return res.redirect("/admin/exams");
    }
  },
};