const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const {
  loadAcademicScopeLists,
  resolveAcademicScope,
  buildAcademicScopeFilter,
} = require("../../../utils/tenantAcademicScope");

const cleanStr = (v, max = 1000) => String(v || "").trim().slice(0, max);
const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const escapeRegex = (input) => String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function slugCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function parseDateTime(v) {
  if (!v) return null;
  const d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMinutes(hhmm) {
  const s = String(hhmm || "").trim();
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const EXAM_TYPES = ["test", "quiz", "midterm", "endterm", "mock", "practical", "oral", "assignment"];
const STATUSES = ["draft", "scheduled", "completed", "archived"];

function buildExamCode(body) {
  const examType = cleanStr(body.examType || "test", 20).toUpperCase();
  const ay = cleanStr(body.academicYear || "", 20).replace(/[^0-9]/g, "").slice(0, 8);
  const term = Math.max(1, Math.min(Number(body.term || 1), 3));
  return slugCode(`${examType}-T${term}-${ay || "YEAR"}`);
}

const examRules = [
  body("title")
    .trim()
    .isLength({ min: 2, max: 180 })
    .withMessage("Exam title is required (2-180 chars)."),

  body("code")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 40 })
    .withMessage("Code must be 2-40 chars."),

  body("classGroup")
    .custom((v) => isObjId(v))
    .withMessage("Class is required."),

  body("sectionId")
    .optional({ checkFalsy: true })
    .custom((v) => !v || isObjId(v))
    .withMessage("Invalid section."),

  body("streamId")
    .optional({ checkFalsy: true })
    .custom((v) => !v || isObjId(v))
    .withMessage("Invalid stream."),

  body("subject")
    .custom((v) => isObjId(v))
    .withMessage("Subject is required."),

  body("teacher")
    .optional({ checkFalsy: true })
    .custom((v) => !v || isObjId(v))
    .withMessage("Invalid teacher."),

  body("academicYear")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 20 }),

  body("term")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 3 })
    .toInt()
    .withMessage("Term must be 1-3."),

  body("examType")
    .optional({ checkFalsy: true })
    .isIn(EXAM_TYPES)
    .withMessage("Invalid exam type."),

  body("examDate")
    .custom((v) => !!parseDateTime(v))
    .withMessage("Exam date is required."),

  body("startTime")
    .optional({ checkFalsy: true })
    .custom((v) => !v || toMinutes(v) !== null)
    .withMessage("Invalid start time."),

  body("endTime")
    .optional({ checkFalsy: true })
    .custom((v) => !v || toMinutes(v) !== null)
    .withMessage("Invalid end time."),

  body("durationMinutes")
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 1440 })
    .toInt(),

  body("maxMarks")
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 1000 })
    .toFloat(),

  body("passMark")
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 1000 })
    .toFloat(),

  body("room")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 }),

  body("campus")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 }),

  body("instructions")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 3000 }),

  body("status")
    .optional({ checkFalsy: true })
    .isIn(STATUSES)
    .withMessage("Invalid status."),
];

async function buildKpis(Exam, filter) {
  const rows = await Exam.aggregate([
    { $match: filter },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return {
    total: Object.values(map).reduce((a, b) => a + b, 0),
    draft: map.draft || 0,
    scheduled: map.scheduled || 0,
    completed: map.completed || 0,
    archived: map.archived || 0,
  };
}

module.exports = {
  examRules,

  list: async (req, res) => {
    try {
      const { Exam, Class, Subject, Staff } = req.models;

      const q = cleanStr(req.query.q, 120);
      const classGroup = cleanStr(req.query.classGroup, 80);
      const sectionId = cleanStr(req.query.sectionId, 80);
      const streamId = cleanStr(req.query.streamId, 80);
      const subject = cleanStr(req.query.subject, 80);
      const examType = cleanStr(req.query.examType, 40);
      const status = cleanStr(req.query.status, 20);
      const academicYear = cleanStr(req.query.academicYear, 20);
      const term = cleanStr(req.query.term, 10);
      const from = parseDateTime(req.query.from);
      const to = parseDateTime(req.query.to);

      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 20;

      const filter = {};

      Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));
      if (subject && isObjId(subject)) filter.subject = subject;
      if (examType && EXAM_TYPES.includes(examType)) filter.examType = examType;
      if (status && STATUSES.includes(status)) filter.status = status;
      if (academicYear) filter.academicYear = academicYear;
      if (term && !Number.isNaN(Number(term))) filter.term = Number(term);

      if (from || to) {
        filter.examDate = {};
        if (from) filter.examDate.$gte = from;
        if (to) filter.examDate.$lte = to;
      }

      if (q) {
        const safeQ = escapeRegex(q);
        filter.$or = [
          { title: { $regex: safeQ, $options: "i" } },
          { code: { $regex: safeQ, $options: "i" } },
          { room: { $regex: safeQ, $options: "i" } },
          { campus: { $regex: safeQ, $options: "i" } },
          { instructions: { $regex: safeQ, $options: "i" } },
        ];
      }

      const total = await Exam.countDocuments(filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      const exams = await Exam.find(filter)
        .populate({ path: "classGroup", select: "name code" })
        .populate({ path: "sectionId", select: "name code" })
        .populate({ path: "streamId", select: "name code" })
        .populate({ path: "subject", select: "title code shortTitle" })
        .populate({ path: "teacher", select: "fullName name email role" })
        .sort({ examDate: -1, createdAt: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const classes = await Class.find({})
        .sort({ name: 1 })
        .select("name code classLevel academicYear term")
        .lean();

      const subjects = await Subject.find({})
        .sort({ title: 1, code: 1 })
        .select("title code shortTitle classId className sectionId sectionName streamId streamName academicYear term")
        .lean();

      const staffList = await Staff.find({})
        .sort({ fullName: 1, name: 1 })
        .select("fullName name email role")
        .lean();

      const kpis = await buildKpis(Exam, filter);
      const scopeLists = await loadAcademicScopeLists(req);

      return res.render("tenant/exams/index", {
        tenant: req.tenant || null,
        exams,
        classes,
        sections: scopeLists.sections,
        streams: scopeLists.streams,
        subjects,
        subjectOptions: scopeLists.subjects,
        staffList,
        examTypes: EXAM_TYPES,
        csrfToken: res.locals.csrfToken || null,
        kpis,
        query: {
          q,
          classGroup,
          sectionId,
          streamId,
          subject,
          examType,
          status,
          academicYear,
          term,
          from: req.query.from || "",
          to: req.query.to || "",
          page: safePage,
          perPage,
          total,
          totalPages,
        },
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
      const title = cleanStr(req.body.title, 180);
      let code = cleanStr(req.body.code, 40).toUpperCase();
      if (!code) code = buildExamCode(req.body);
      code = slugCode(code);

      const examDate = parseDateTime(req.body.examDate);
      const startMin = toMinutes(req.body.startTime);
      const endMin = toMinutes(req.body.endTime);

      if (startMin !== null && endMin !== null && endMin <= startMin) {
        req.flash?.("error", "End time must be later than start time.");
        return res.redirect("/admin/exams");
      }

      const scope = await resolveAcademicScope(req, {
        classId: req.body.classGroup,
        sectionId: req.body.sectionId,
        streamId: req.body.streamId,
      });
      if (scope.errors.length || !scope.payload.classId) {
        req.flash?.("error", scope.errors.join(" ") || "Class is required.");
        return res.redirect("/admin/exams");
      }

      const doc = {
        title,
        code,
        classGroup: scope.payload.classId,
        sectionId: scope.payload.sectionId || null,
        sectionName: scope.payload.sectionName || "",
        sectionCode: scope.payload.sectionCode || "",
        streamId: scope.payload.streamId || null,
        streamName: scope.payload.streamName || "",
        streamCode: scope.payload.streamCode || "",
        subject: req.body.subject,
        teacher: isObjId(req.body.teacher) ? req.body.teacher : null,
        academicYear: cleanStr(req.body.academicYear, 20),
        term: Math.max(1, Math.min(Number(req.body.term || 1), 3)),
        examType: EXAM_TYPES.includes(req.body.examType) ? req.body.examType : "test",
        examDate,
        startTime: cleanStr(req.body.startTime, 5),
        endTime: cleanStr(req.body.endTime, 5),
        durationMinutes: Math.max(0, Math.min(Number(req.body.durationMinutes || 0), 1440)),
        maxMarks: Math.max(0, Math.min(Number(req.body.maxMarks || 100), 1000)),
        passMark: Math.max(0, Math.min(Number(req.body.passMark || 50), 1000)),
        room: cleanStr(req.body.room, 80),
        campus: cleanStr(req.body.campus, 80),
        instructions: cleanStr(req.body.instructions, 3000),
        status: STATUSES.includes(req.body.status) ? req.body.status : "draft",
        createdBy: req.user?._id || null,
      };

      await Exam.create(doc);

      req.flash?.("success", "Exam created.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM CREATE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "An exam with similar setup already exists.");
      else req.flash?.("error", "Failed to create exam.");
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
      const id = cleanStr(req.params.id, 80);
      if (!isObjId(id)) {
        req.flash?.("error", "Invalid exam id.");
        return res.redirect("/admin/exams");
      }

      const title = cleanStr(req.body.title, 180);
      let code = cleanStr(req.body.code, 40).toUpperCase();
      if (!code) code = buildExamCode(req.body);
      code = slugCode(code);

      const examDate = parseDateTime(req.body.examDate);
      const startMin = toMinutes(req.body.startTime);
      const endMin = toMinutes(req.body.endTime);

      if (startMin !== null && endMin !== null && endMin <= startMin) {
        req.flash?.("error", "End time must be later than start time.");
        return res.redirect("/admin/exams");
      }

      const scope = await resolveAcademicScope(req, {
        classId: req.body.classGroup,
        sectionId: req.body.sectionId,
        streamId: req.body.streamId,
      });
      if (scope.errors.length || !scope.payload.classId) {
        req.flash?.("error", scope.errors.join(" ") || "Class is required.");
        return res.redirect("/admin/exams");
      }

      await Exam.updateOne(
        { _id: id },
        {
          $set: {
            title,
            code,
            classGroup: scope.payload.classId,
            sectionId: scope.payload.sectionId || null,
            sectionName: scope.payload.sectionName || "",
            sectionCode: scope.payload.sectionCode || "",
            streamId: scope.payload.streamId || null,
            streamName: scope.payload.streamName || "",
            streamCode: scope.payload.streamCode || "",
            subject: req.body.subject,
            teacher: isObjId(req.body.teacher) ? req.body.teacher : null,
            academicYear: cleanStr(req.body.academicYear, 20),
            term: Math.max(1, Math.min(Number(req.body.term || 1), 3)),
            examType: EXAM_TYPES.includes(req.body.examType) ? req.body.examType : "test",
            examDate,
            startTime: cleanStr(req.body.startTime, 5),
            endTime: cleanStr(req.body.endTime, 5),
            durationMinutes: Math.max(0, Math.min(Number(req.body.durationMinutes || 0), 1440)),
            maxMarks: Math.max(0, Math.min(Number(req.body.maxMarks || 100), 1000)),
            passMark: Math.max(0, Math.min(Number(req.body.passMark || 50), 1000)),
            room: cleanStr(req.body.room, 80),
            campus: cleanStr(req.body.campus, 80),
            instructions: cleanStr(req.body.instructions, 3000),
            status: STATUSES.includes(req.body.status) ? req.body.status : "draft",
            updatedBy: req.user?._id || null,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Exam updated.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM UPDATE ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "An exam with similar setup already exists.");
      else req.flash?.("error", "Failed to update exam.");
      return res.redirect("/admin/exams");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Exam } = req.models;
      const id = cleanStr(req.params.id, 80);
      const status = cleanStr(req.body.status, 20);

      if (!isObjId(id)) {
        req.flash?.("error", "Invalid exam id.");
        return res.redirect("/admin/exams");
      }

      if (!STATUSES.includes(status)) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/exams");
      }

      await Exam.updateOne(
        { _id: id },
        { $set: { status, updatedBy: req.user?._id || null } }
      );

      req.flash?.("success", "Exam status updated.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM STATUS ERROR:", err);
      req.flash?.("error", "Failed to update exam status.");
      return res.redirect("/admin/exams");
    }
  },

  remove: async (req, res) => {
    try {
      const { Exam } = req.models;
      const id = cleanStr(req.params.id, 80);

      if (!isObjId(id)) {
        req.flash?.("error", "Invalid exam id.");
        return res.redirect("/admin/exams");
      }

      await Exam.deleteOne({ _id: id });
      req.flash?.("success", "Exam deleted.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM DELETE ERROR:", err);
      req.flash?.("error", "Failed to delete exam.");
      return res.redirect("/admin/exams");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Exam } = req.models;

      const action = cleanStr(req.body.action, 30);
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x));

      if (!ids.length) {
        req.flash?.("error", "No exams selected.");
        return res.redirect("/admin/exams");
      }

      if (action === "draft" || action === "scheduled" || action === "completed" || action === "archived") {
        await Exam.updateMany({ _id: { $in: ids } }, { $set: { status: action } });
        req.flash?.("success", `Updated ${ids.length} exam(s).`);
        return res.redirect("/admin/exams");
      }

      if (action === "delete") {
        await Exam.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", `Deleted ${ids.length} exam(s).`);
        return res.redirect("/admin/exams");
      }

      req.flash?.("error", "Invalid bulk action.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/exams");
    }
  },
};

