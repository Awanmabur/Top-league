const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const {
  loadAcademicScopeLists,
  resolveAcademicScope,
  buildAcademicScopeFilter,
} = require("../../../utils/tenantAcademicScope");
const {
  assertStatusTransition,
  assertEditAllowed,
  assertHardDeleteAllowed,
  countExamResults,
  assertSubjectMatchesScope,
  publishedScheduleChanged,
  notifyTargetStudents,
  retireExamNotifications,
  cloneWith,
} = require("../../../services/tenant/examService");

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

function parseDateOnly(v) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let d;
  if (direct) d = new Date(Date.UTC(Number(direct[1]), Number(direct[2]) - 1, Number(direct[3])));
  else {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    d = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
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
    .custom((v) => !!parseDateOnly(v))
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


async function buildExamPayload(req) {
  const title = cleanStr(req.body.title, 180);
  let code = cleanStr(req.body.code, 40).toUpperCase();
  if (!code) code = buildExamCode(req.body);
  code = slugCode(code);

  const examDate = parseDateOnly(req.body.examDate);
  const startMin = toMinutes(req.body.startTime);
  const endMin = toMinutes(req.body.endTime);
  if (!examDate) throw new Error("Exam date is required.");
  if (startMin !== null && endMin !== null && endMin <= startMin) {
    throw new Error("End time must be later than start time.");
  }

  const scope = await resolveAcademicScope(req, {
    classId: req.body.classGroup,
    sectionId: req.body.sectionId,
    streamId: req.body.streamId,
  });
  if (scope.errors.length || !scope.payload.classId) {
    throw new Error(scope.errors.join(" ") || "Class is required.");
  }

  const academicYear = cleanStr(req.body.academicYear || scope.payload.academicYear, 20);
  const term = Math.max(1, Math.min(Number(req.body.term || scope.payload.term || 1), 3));
  await assertSubjectMatchesScope(req.models, req.body.subject, scope.payload, { academicYear, term });

  const maxMarks = Math.max(0, Math.min(Number(req.body.maxMarks || 100), 1000));
  const passMark = Math.max(0, Math.min(Number(req.body.passMark || 50), 1000));
  if (passMark > maxMarks) throw new Error("Pass mark cannot be greater than maximum marks.");

  let durationMinutes = Math.max(0, Math.min(Number(req.body.durationMinutes || 0), 1440));
  if (!durationMinutes && startMin !== null && endMin !== null) durationMinutes = endMin - startMin;

  return {
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
    academicYear,
    term,
    examType: EXAM_TYPES.includes(req.body.examType) ? req.body.examType : "test",
    examDate,
    startTime: cleanStr(req.body.startTime, 5),
    endTime: cleanStr(req.body.endTime, 5),
    durationMinutes,
    maxMarks,
    passMark,
    room: cleanStr(req.body.room, 80),
    campus: cleanStr(req.body.campus, 80),
    instructions: cleanStr(req.body.instructions, 3000),
    status: STATUSES.includes(req.body.status) ? req.body.status : "draft",
  };
}

function flashExamError(req, err, fallback) {
  if (String(err?.code) === "11000") req.flash?.("error", "An exam with similar setup already exists.");
  else req.flash?.("error", err?.message || fallback);
}

async function findExamOrThrow(Exam, id) {
  if (!isObjId(id)) throw new Error("Invalid exam id.");
  const exam = await Exam.findById(id).lean();
  if (!exam) throw new Error("Exam not found.");
  return exam;
}

async function runNotificationTask(req, label, task) {
  try {
    return await task();
  } catch (err) {
    console.error(`EXAM ${label} NOTIFICATION ERROR:`, err);
    req.flash?.("error", "The exam change was saved, but student notifications could not be fully synchronized. Retry the notification operation after checking the notification service.");
    return null;
  }
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
      const from = parseDateOnly(req.query.from);
      const to = parseDateOnly(req.query.to);

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
        if (to) {
          const afterTo = new Date(to.getTime());
          afterTo.setUTCDate(afterTo.getUTCDate() + 1);
          filter.examDate.$lt = afterTo;
        }
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
      const payload = await buildExamPayload(req);
      assertStatusTransition("draft", payload.status, { creating: true });
      const now = new Date();
      const created = await Exam.create({
        ...payload,
        publishedAt: payload.status === "scheduled" ? now : null,
        scheduleUpdatedAt: payload.status === "scheduled" ? now : null,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });

      if (payload.status === "scheduled") {
        await runNotificationTask(req, "CREATE", () => notifyTargetStudents(req.models, created, "scheduled", req.user?._id || null));
      }

      req.flash?.("success", payload.status === "scheduled" ? "Exam created and scheduled." : "Exam created.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM CREATE ERROR:", err);
      flashExamError(req, err, "Failed to create exam.");
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
      const current = await findExamOrThrow(Exam, id);
      const resultCount = await countExamResults(req.models, id);
      const payload = await buildExamPayload(req);
      const next = cloneWith(current, payload);

      assertEditAllowed(current, next, { resultCount });
      assertStatusTransition(current.status, payload.status, { resultCount });

      const now = new Date();
      const scheduleChanged = publishedScheduleChanged(current, next);
      const lifecycle = {};
      if (current.status !== payload.status && payload.status === "scheduled") {
        lifecycle.publishedAt = current.publishedAt || now;
        lifecycle.scheduleUpdatedAt = now;
      }
      if (scheduleChanged) lifecycle.scheduleUpdatedAt = now;
      if (current.status !== payload.status && payload.status === "completed") lifecycle.completedAt = current.completedAt || now;
      if (current.status !== payload.status && payload.status === "archived") lifecycle.archivedAt = now;
      if (current.status === "archived" && payload.status !== "archived") lifecycle.archivedAt = null;

      const write = await Exam.updateOne(
        { _id: id, updatedAt: current.updatedAt },
        { $set: { ...payload, ...lifecycle, updatedBy: req.user?._id || null } },
        { runValidators: true }
      );
      if (Number(write.matchedCount ?? write.n ?? 0) !== 1) {
        throw new Error("This exam changed in another session. Reload and try again.");
      }

      const after = cloneWith(current, payload);
      after._id = current._id;
      if (current.status !== "scheduled" && payload.status === "scheduled") {
        await runNotificationTask(req, "UPDATE", () => notifyTargetStudents(req.models, after, "scheduled", req.user?._id || null));
      } else if (scheduleChanged) {
        await runNotificationTask(req, "UPDATE", () => notifyTargetStudents(req.models, after, "schedule_changed", req.user?._id || null));
      }
      if (["scheduled", "completed"].includes(current.status) && !["scheduled", "completed"].includes(payload.status)) {
        await runNotificationTask(req, "WITHDRAW", () => retireExamNotifications(req.models, current._id, req.user?._id || null));
      }

      req.flash?.("success", "Exam updated.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM UPDATE ERROR:", err);
      flashExamError(req, err, "Failed to update exam.");
      return res.redirect("/admin/exams");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Exam } = req.models;
      const id = cleanStr(req.params.id, 80);
      const status = cleanStr(req.body.status, 20).toLowerCase();
      const current = await findExamOrThrow(Exam, id);
      const resultCount = await countExamResults(req.models, id);
      assertStatusTransition(current.status, status, { resultCount });

      const now = new Date();
      const lifecycle = { status, updatedBy: req.user?._id || null };
      if (status === "scheduled") {
        lifecycle.publishedAt = current.publishedAt || now;
        lifecycle.scheduleUpdatedAt = now;
      }
      if (status === "completed") lifecycle.completedAt = current.completedAt || now;
      if (status === "archived") lifecycle.archivedAt = now;
      if (current.status === "archived" && status !== "archived") lifecycle.archivedAt = null;

      const write = await Exam.updateOne(
        { _id: id, updatedAt: current.updatedAt },
        { $set: lifecycle },
        { runValidators: true }
      );
      if (Number(write.matchedCount ?? write.n ?? 0) !== 1) {
        throw new Error("This exam changed in another session. Reload and try again.");
      }

      if (current.status !== "scheduled" && status === "scheduled") {
        await runNotificationTask(req, "STATUS", () => notifyTargetStudents(req.models, cloneWith(current, { status }), "scheduled", req.user?._id || null));
      }
      if (["scheduled", "completed"].includes(current.status) && !["scheduled", "completed"].includes(status)) {
        await runNotificationTask(req, "WITHDRAW", () => retireExamNotifications(req.models, current._id, req.user?._id || null));
      }

      req.flash?.("success", "Exam status updated.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM STATUS ERROR:", err);
      flashExamError(req, err, "Failed to update exam status.");
      return res.redirect("/admin/exams");
    }
  },

  remove: async (req, res) => {
    try {
      const { Exam } = req.models;
      const id = cleanStr(req.params.id, 80);
      const current = await findExamOrThrow(Exam, id);
      const resultCount = await countExamResults(req.models, id);
      assertHardDeleteAllowed(current, resultCount);

      const write = await Exam.deleteOne({ _id: id, status: "draft", updatedAt: current.updatedAt });
      if (Number(write.deletedCount ?? write.n ?? 0) !== 1) {
        throw new Error("This exam changed in another session. Reload and try again.");
      }

      req.flash?.("success", "Draft exam deleted.");
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM DELETE ERROR:", err);
      flashExamError(req, err, "Failed to delete exam.");
      return res.redirect("/admin/exams");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Exam } = req.models;
      const action = cleanStr(req.body.action, 30).toLowerCase();
      const ids = [...new Set(String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isObjId(x)))];

      if (!ids.length) throw new Error("No exams selected.");
      if (![...STATUSES, "delete"].includes(action)) throw new Error("Invalid bulk action.");

      const exams = await Exam.find({ _id: { $in: ids } }).lean();
      if (exams.length !== ids.length) throw new Error("One or more selected exams no longer exist.");

      const counts = new Map();
      for (const exam of exams) counts.set(String(exam._id), await countExamResults(req.models, exam._id));

      for (const exam of exams) {
        const resultCount = counts.get(String(exam._id)) || 0;
        if (action === "delete") assertHardDeleteAllowed(exam, resultCount);
        else assertStatusTransition(exam.status, action, { resultCount });
      }

      const now = new Date();
      const ops = exams.map((exam) => {
        if (action === "delete") {
          return { deleteOne: { filter: { _id: exam._id, status: "draft", updatedAt: exam.updatedAt } } };
        }
        const set = { status: action, updatedBy: req.user?._id || null };
        if (action === "scheduled") {
          set.publishedAt = exam.publishedAt || now;
          set.scheduleUpdatedAt = now;
        }
        if (action === "completed") set.completedAt = exam.completedAt || now;
        if (action === "archived") set.archivedAt = now;
        if (exam.status === "archived" && action !== "archived") set.archivedAt = null;
        return { updateOne: { filter: { _id: exam._id, updatedAt: exam.updatedAt }, update: { $set: set } } };
      });
      const write = await Exam.bulkWrite(ops, { ordered: true });
      const affected = action === "delete" ? Number(write.deletedCount ?? write.nRemoved ?? 0) : 0;
      if (action === "delete" && affected !== exams.length) throw new Error("A selected exam changed while the bulk action was running.");
      if (action !== "delete" && Number(write.matchedCount ?? write.nMatched ?? exams.length) !== exams.length) {
        throw new Error("A selected exam changed while the bulk action was running.");
      }

      if (action === "scheduled") {
        for (const exam of exams) {
          if (exam.status !== "scheduled") {
            await runNotificationTask(req, "BULK", () => notifyTargetStudents(req.models, cloneWith(exam, { status: "scheduled" }), "scheduled", req.user?._id || null));
          }
        }
      } else if (!["scheduled", "completed"].includes(action)) {
        for (const exam of exams) {
          if (["scheduled", "completed"].includes(exam.status)) {
            await runNotificationTask(req, "BULK WITHDRAW", () => retireExamNotifications(req.models, exam._id, req.user?._id || null));
          }
        }
      }

      req.flash?.("success", action === "delete" ? `Deleted ${exams.length} draft exam(s).` : `Updated ${exams.length} exam(s).`);
      return res.redirect("/admin/exams");
    } catch (err) {
      console.error("EXAM BULK ERROR:", err);
      flashExamError(req, err, "Bulk action failed.");
      return res.redirect("/admin/exams");
    }
  },
};
