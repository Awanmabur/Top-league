const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const {
  loadAcademicScopeLists,
  buildAcademicScopeFilter,
} = require("../../../utils/tenantAcademicScope");
const {
  escapeRegExp,
  csvCell,
  targetStudentFilter,
  buildResultValues,
  assertExamAllowsResultEntry,
  assertExamAllowsPublication,
  assertResultEditable,
  assertIdentityChangeAllowed,
  assertDeleteAllowed,
  resultStatusUpdate,
} = require("../../../services/tenant/resultService");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());

function parseCsvBuffer(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8").replace(/^\uFEFF/, "") : String(buffer || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (inQuotes) throw new Error("CSV contains an unterminated quoted field.");
  if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x || "").trim() !== ""));
}

function isProbablyCsvText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  if (buffer.includes(0)) return false;
  let controls = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  }
  if (controls / Math.max(sample.length, 1) > 0.01) return false;
  const text = sample.toString("utf8");
  return !text.includes("\uFFFD");
}

const resultRules = [
  body("exam").custom((v) => isId(v)).withMessage("Exam is required."),
  body("student").custom((v) => isId(v)).withMessage("Student is required."),
  body("score").isFloat({ min: 0, max: 100000 }).withMessage("Score must be a valid non-negative number."),
  body("grade").optional({ checkFalsy: true }).trim().isLength({ max: 10 }),
  body("remark").optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body("status").optional({ checkFalsy: true }).isIn(["draft", "published"]).withMessage("Invalid status."),
];

function normalizeResultCard(r) {
  const s = r.student || {};
  const e = r.exam || {};
  return {
    id: String(r._id || ""),
    examId: e._id ? String(e._id) : String(r.exam || ""),
    examTitle: e.title || "",
    examStatus: e.status || "",
    studentId: s._id ? String(s._id) : String(r.student || ""),
    studentName: s.fullName || s.name || "Student",
    regNo: s.regNo || s.studentNo || s.studentNumber || s.indexNumber || "",
    className: r.classGroup?.name || r.classGroup?.title || r.classGroup?.code || "",
    sectionName: r.sectionName || r.sectionId?.name || "",
    streamName: r.streamName || r.streamId?.name || "",
    subjectInfo: r.subject ? `${r.subject.code || ""}${r.subject.code ? " — " : ""}${r.subject.title || ""}`.trim() : "",
    academicYear: r.academicYear || "",
    term: Number(r.term || 1),
    totalMarks: Number(r.totalMarks ?? 100),
    passMark: Number(r.passMark ?? e.passMark ?? 50),
    score: Number(r.score ?? 0),
    percentage: Number(r.percentage ?? 0),
    grade: r.grade || "",
    remark: r.remark || "",
    status: r.status || "draft",
    everPublished: !!(r.firstPublishedAt || r.publishedAt || r.publishedBy || r.reopenedAt || r.reopenedBy),
    revision: Number(r.revision || 0),
    enteredBy: r.enteredBy?.fullName || r.enteredBy?.name || "",
    publishedBy: r.publishedBy?.fullName || r.publishedBy?.name || "",
    reopenedBy: r.reopenedBy?.fullName || r.reopenedBy?.name || "",
    publishedAt: r.publishedAt ? new Date(r.publishedAt).toLocaleString() : "",
    firstPublishedAt: r.firstPublishedAt ? new Date(r.firstPublishedAt).toLocaleString() : "",
    reopenedAt: r.reopenedAt ? new Date(r.reopenedAt).toLocaleString() : "",
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "",
  };
}

function buildFilterPayload(req) {
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim();
  const exam = String(req.query.exam || "").trim();
  const classGroup = String(req.query.classGroup || "").trim();
  const sectionId = String(req.query.sectionId || "").trim();
  const streamId = String(req.query.streamId || "").trim();
  const subject = String(req.query.subject || "").trim();
  const academicYear = String(req.query.academicYear || "").trim();
  const term = String(req.query.term || "").trim();
  const grade = String(req.query.grade || "").trim();
  const minScore = String(req.query.minScore || "").trim();
  const maxScore = String(req.query.maxScore || "").trim();

  const filter = { migrationQuarantinedAt: null };
  if (status) filter.status = status;
  if (grade) filter.grade = grade;
  if (academicYear) filter.academicYear = academicYear;
  if (term && Number.isFinite(Number(term))) filter.term = Number(term);
  if (exam && isId(exam)) filter.exam = exam;
  Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));
  if (subject && isId(subject)) filter.subject = subject;
  if (minScore && Number.isFinite(Number(minScore))) filter.score = { ...(filter.score || {}), $gte: Number(minScore) };
  if (maxScore && Number.isFinite(Number(maxScore))) filter.score = { ...(filter.score || {}), $lte: Number(maxScore) };
  return { q, status, exam, classGroup, sectionId, streamId, subject, academicYear, term, grade, minScore, maxScore, filter };
}

async function attachSearchFilter(models, q, filter) {
  if (!q) return filter;
  const { Student, Exam } = models;
  const safe = escapeRegExp(q);
  const [studentHits, examHits] = await Promise.all([
    Student.find({
      isDeleted: { $ne: true },
      $or: [
        { fullName: { $regex: safe, $options: "i" } },
        { name: { $regex: safe, $options: "i" } },
        { regNo: { $regex: safe, $options: "i" } },
        { studentNo: { $regex: safe, $options: "i" } },
        { indexNumber: { $regex: safe, $options: "i" } },
      ],
    }).select("_id").limit(2000).lean(),
    Exam.find({ title: { $regex: safe, $options: "i" } }).select("_id").limit(2000).lean(),
  ]);
  const studentIds = studentHits.map((x) => x._id);
  const examIds = examHits.map((x) => x._id);
  filter.$or = [
    ...(studentIds.length ? [{ student: { $in: studentIds } }] : []),
    ...(examIds.length ? [{ exam: { $in: examIds } }] : []),
  ];
  if (!filter.$or.length) filter._id = { $in: [] };
  return filter;
}

function buildResultPopulate(models) {
  const { Exam, Student, Subject, Class, Section, Stream, User, Staff, Admin } = models;
  const populate = [
    { path: "exam", model: Exam, select: "title status maxMarks passMark academicYear term subject classGroup sectionId sectionName streamId streamName" },
    { path: "student", model: Student, select: "fullName name regNo studentNo studentNumber indexNumber" },
    { path: "subject", model: Subject, select: "title code shortTitle passMark" },
    { path: "classGroup", model: Class, select: "name title code" },
  ];
  if (Section) populate.push({ path: "sectionId", model: Section, select: "name code" });
  if (Stream) populate.push({ path: "streamId", model: Stream, select: "name code" });
  const actorModel = User || Staff || Admin;
  if (actorModel) {
    for (const path of ["enteredBy", "publishedBy", "reopenedBy", "updatedBy"]) {
      populate.push({ path, model: actorModel, select: "fullName name email" });
    }
  }
  return populate;
}

const examSelect = "title status archivedAt classGroup sectionId sectionName sectionCode streamId streamName streamCode subject academicYear term maxMarks passMark";
const studentSelect = "fullName name regNo studentNo indexNumber classId classGroup sectionId streamId academicYear term status isDeleted";

async function loadExamStudent(models, examId, studentId) {
  const { Exam, Student } = models;
  return Promise.all([
    Exam.findById(examId).select(examSelect).lean(),
    Student.findById(studentId).select(studentSelect).lean(),
  ]);
}

function flashError(req, err, fallback) {
  req.flash?.("error", err?.message || fallback);
}

async function insertPreparedWithCompensation(req, prepared) {
  const { Result } = req.models;
  const canTx = !!req.tenantConnection?.startSession;
  if (canTx) {
    const session = await req.tenantConnection.startSession();
    try {
      let created = [];
      await session.withTransaction(async () => {
        created = await Result.insertMany(prepared, { ordered: true, session });
      });
      return created.length;
    } catch (err) {
      const msg = String(err?.message || "");
      const unsupported = /Transaction|replica set|not supported/i.test(msg);
      if (!unsupported) throw err;
    } finally {
      await session.endSession().catch(() => {});
    }
  }

  const insertedIds = [];
  try {
    for (const row of prepared) {
      const doc = await Result.create(row);
      insertedIds.push(doc._id);
    }
    return insertedIds.length;
  } catch (err) {
    if (insertedIds.length) {
      await Result.deleteMany({ _id: { $in: insertedIds } }).catch((rollbackErr) => {
        console.error("RESULT IMPORT COMPENSATION ERROR:", rollbackErr);
      });
    }
    throw err;
  }
}


function buildBulkOperations(rows, action, examMap, actorId) {
  const ops = [];
  for (const row of rows) {
    if (action === "delete") {
      assertDeleteAllowed(row);
      ops.push({
        deleteOne: {
          filter: { _id: row._id, status: row.status, updatedAt: row.updatedAt, firstPublishedAt: null },
        },
      });
      continue;
    }
    const exam = examMap.get(String(row.exam));
    if (!exam) throw new Error("A selected result has no linked exam.");
    const next = action === "publish" ? "published" : "draft";
    const update = resultStatusUpdate(row, next, actorId, exam);
    ops.push({
      updateOne: {
        filter: { _id: row._id, status: row.status, updatedAt: row.updatedAt },
        update: { $set: update },
      },
    });
  }
  return ops;
}

async function applyBulkWithCompensation(req, rows, action, examMap) {
  const { Result } = req.models;
  const actorId = req.user?._id || null;
  const ops = buildBulkOperations(rows, action, examMap, actorId);
  const expected = rows.length;

  if (req.tenantConnection?.startSession) {
    const session = await req.tenantConnection.startSession();
    try {
      let affected = 0;
      await session.withTransaction(async () => {
        const write = await Result.bulkWrite(ops, { ordered: true, session });
        affected = action === "delete" ? Number(write.deletedCount || 0) : Number(write.matchedCount || 0);
        if (affected !== expected) throw new Error("Some selected results changed in another session. Reload before retrying the bulk action.");
      });
      return affected;
    } catch (err) {
      const unsupported = /Transaction|replica set|not supported/i.test(String(err?.message || ""));
      if (!unsupported) throw err;
    } finally {
      await session.endSession().catch(() => {});
    }
  }

  const applied = [];
  try {
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      const before = rows[i];
      if (op.deleteOne) {
        const write = await Result.deleteOne(op.deleteOne.filter);
        if (Number(write.deletedCount || 0) !== 1) throw new Error("A selected result changed in another session. No partial bulk change was kept.");
        applied.push({ kind: "delete", before });
      } else {
        const write = await Result.updateOne(op.updateOne.filter, op.updateOne.update);
        if (Number(write.matchedCount || 0) !== 1) throw new Error("A selected result changed in another session. No partial bulk change was kept.");
        applied.push({ kind: "update", before });
      }
    }
    return applied.length;
  } catch (err) {
    for (const item of applied.reverse()) {
      try {
        if (item.kind === "delete") await Result.collection.insertOne(item.before);
        else await Result.collection.replaceOne({ _id: item.before._id }, item.before, { upsert: true });
      } catch (rollbackErr) {
        console.error("RESULT BULK COMPENSATION ERROR:", rollbackErr);
      }
    }
    throw err;
  }
}

module.exports = {
  resultRules,

  options: async (req, res) => {
    try {
      const { Exam, Student, Subject, Class, Section, Stream } = req.models;
      const examId = String(req.query.exam || "").trim();
      if (!isId(examId)) return res.json({ ok: false, message: "Invalid exam id." });
      const exam = await Exam.findById(examId).select(examSelect).lean();
      if (!exam) return res.json({ ok: false, message: "Exam not found." });
      try { assertExamAllowsResultEntry(exam); } catch (err) { return res.json({ ok: false, message: err.message }); }

      const students = await Student.find(targetStudentFilter(exam))
        .select(studentSelect)
        .sort({ fullName: 1, name: 1 })
        .limit(2000)
        .lean();
      const [classDoc, subjectDoc, sectionDoc, streamDoc] = await Promise.all([
        exam.classGroup ? Class.findById(exam.classGroup).select("name title code").lean() : null,
        exam.subject ? Subject.findById(exam.subject).select("title code").lean() : null,
        Section && exam.sectionId ? Section.findById(exam.sectionId).select("name code").lean() : null,
        Stream && exam.streamId ? Stream.findById(exam.streamId).select("name code").lean() : null,
      ]);
      return res.json({
        ok: true,
        exam: { _id: exam._id, title: exam.title || "", status: exam.status || "", classGroup: exam.classGroup || null, sectionId: exam.sectionId || null, streamId: exam.streamId || null, subject: exam.subject || null, academicYear: exam.academicYear || "", term: exam.term || 1, totalMarks: exam.maxMarks ?? 100 },
        labels: {
          classGroup: classDoc?.name || classDoc?.title || classDoc?.code || "",
          section: exam.sectionName || sectionDoc?.name || sectionDoc?.code || "",
          stream: exam.streamName || streamDoc?.name || streamDoc?.code || "",
          subject: subjectDoc ? `${subjectDoc.code || ""}${subjectDoc.code ? " — " : ""}${subjectDoc.title || ""}`.trim() : "",
        },
        students: students.map((s) => ({ _id: s._id, fullName: s.fullName || s.name || "Student", regNo: s.regNo || s.studentNo || s.indexNumber || "" })),
      });
    } catch (err) {
      console.error("RESULT OPTIONS ERROR:", err);
      return res.json({ ok: false, message: "Failed to load options." });
    }
  },

  list: async (req, res) => {
    try {
      const { Result, Exam, Subject } = req.models;
      const parsed = buildFilterPayload(req);
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;
      await attachSearchFilter(req.models, parsed.q, parsed.filter);
      const kpiFilter = { ...parsed.filter };
      delete kpiFilter.status;
      const [total, exams, subjects, statusRows, aggregate, scopeLists] = await Promise.all([
        Result.countDocuments(parsed.filter),
        Exam.find({ status: { $in: ["scheduled", "completed"] }, archivedAt: null }).select("title status classGroup sectionId streamId subject academicYear term").sort({ examDate: -1, createdAt: -1 }).limit(300).lean(),
        Subject.find({ status: { $ne: "archived" } }).select("title code classId sectionId streamId").sort({ title: 1 }).limit(500).lean(),
        Result.aggregate([{ $match: kpiFilter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
        Result.aggregate([{ $match: parsed.filter }, { $group: { _id: null, avg: { $avg: "$percentage" } } }]),
        loadAcademicScopeLists(req),
      ]);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);
      let query = Result.find(parsed.filter);
      for (const pop of buildResultPopulate(req.models)) query = query.populate(pop);
      const results = await query.sort({ updatedAt: -1, _id: -1 }).skip((safePage - 1) * perPage).limit(perPage).lean();
      const statusCounts = Object.fromEntries(statusRows.map((row) => [String(row._id || ""), Number(row.count || 0)]));
      const published = statusCounts.published || 0;
      const draft = statusCounts.draft || 0;
      const avgScore = aggregate[0]?.avg == null ? 0 : Math.round(Number(aggregate[0].avg) * 100) / 100;
      const resultsData = results.map(normalizeResultCard);
      const exportParams = new URLSearchParams();
      Object.entries(parsed).forEach(([k, v]) => { if (k !== "filter" && v !== undefined && v !== null && String(v) !== "") exportParams.set(k, String(v)); });
      function buildPageUrl(targetPage) {
        const params = new URLSearchParams();
        Object.entries(parsed).forEach(([k, v]) => { if (k !== "filter" && v !== undefined && v !== null && String(v) !== "") params.set(k, String(v)); });
        params.set("page", String(targetPage));
        return `/admin/results?${params.toString()}`;
      }
      return res.render("tenant/results/index", {
        tenant: req.tenant || null, results, resultsData, exams,
        classes: scopeLists.classes, sections: scopeLists.sections, streams: scopeLists.streams,
        subjects, subjectOptions: scopeLists.subjects, csrfToken: res.locals.csrfToken || null,
        kpis: { total, published, draft, avgScore },
        query: { ...parsed, page: safePage, total, totalPages, perPage },
        exportQueryString: exportParams.toString(),
        pagination: { startPage: Math.max(1, safePage - 2), endPage: Math.min(totalPages, safePage + 2) },
        buildPageUrl,
        messages: { success: req.flash ? req.flash("success") : [], error: req.flash ? req.flash("error") : [] },
      });
    } catch (err) {
      console.error("RESULTS LIST ERROR:", err);
      return res.status(500).send("Failed to load results.");
    }
  },

  create: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { req.flash?.("error", errors.array().map((e) => e.msg).join(" ")); return res.redirect("/admin/results"); }
    try {
      const { Result } = req.models;
      const examId = String(req.body.exam || "").trim();
      const studentId = String(req.body.student || "").trim();
      const [exam, student] = await loadExamStudent(req.models, examId, studentId);
      if (!exam) throw new Error("Exam not found.");
      if (!student) throw new Error("Student not found.");
      const values = buildResultValues({ exam, student, score: req.body.score, grade: req.body.grade, remark: req.body.remark, status: req.body.status || "draft", actorId: req.user?._id || null });
      await Result.create(values);
      req.flash?.("success", "Result saved.");
    } catch (err) {
      console.error("CREATE RESULT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "This student already has a result for this exam.");
      else flashError(req, err, "Failed to save result.");
    }
    return res.redirect("/admin/results");
  },

  update: async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { req.flash?.("error", errors.array().map((e) => e.msg).join(" ")); return res.redirect("/admin/results"); }
    try {
      const { Result } = req.models;
      const id = String(req.params.id || "").trim();
      if (!isId(id)) throw new Error("Invalid result id.");
      const current = await Result.findOne({ _id: id, migrationQuarantinedAt: null }).lean();
      if (!current) throw new Error("Result not found.");
      assertResultEditable(current);
      const examId = String(req.body.exam || "").trim();
      const studentId = String(req.body.student || "").trim();
      assertIdentityChangeAllowed(current, examId, studentId);
      const [exam, student] = await loadExamStudent(req.models, examId, studentId);
      if (!exam) throw new Error("Exam not found.");
      if (!student) throw new Error("Student not found.");
      const collision = await Result.findOne({ exam: examId, student: studentId, _id: { $ne: id }, migrationQuarantinedAt: null }).select("_id").lean();
      if (collision) throw new Error("This student already has a result for this exam.");
      const values = buildResultValues({ exam, student, score: req.body.score, grade: req.body.grade, remark: req.body.remark, status: req.body.status || "draft", actorId: req.user?._id || null, current });
      const write = await Result.updateOne({ _id: id, status: "draft", updatedAt: current.updatedAt }, { $set: values }, { runValidators: true });
      if (!write.matchedCount) throw new Error("This result changed in another session. Reload before saving again.");
      req.flash?.("success", "Result updated.");
    } catch (err) {
      console.error("UPDATE RESULT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "This student already has a result for this exam.");
      else flashError(req, err, "Failed to update result.");
    }
    return res.redirect("/admin/results");
  },

  setStatus: async (req, res) => {
    try {
      const { Result, Exam } = req.models;
      const id = String(req.params.id || "").trim();
      if (!isId(id)) throw new Error("Invalid result id.");
      const current = await Result.findOne({ _id: id, migrationQuarantinedAt: null }).lean();
      if (!current) throw new Error("Result not found.");
      const next = String(req.body.status || "").trim().toLowerCase();
      const exam = await Exam.findById(current.exam).select("status").lean();
      if (!exam) throw new Error("Linked exam not found.");
      const update = resultStatusUpdate(current, next, req.user?._id || null, exam);
      const write = await Result.updateOne({ _id: id, status: current.status, updatedAt: current.updatedAt }, { $set: update });
      if (!write.matchedCount) throw new Error("This result changed in another session. Reload before changing status.");
      req.flash?.("success", next === "published" ? "Result published." : "Result reopened as Draft for correction.");
    } catch (err) {
      console.error("SET RESULT STATUS ERROR:", err);
      flashError(req, err, "Failed to update status.");
    }
    return res.redirect("/admin/results");
  },

  remove: async (req, res) => {
    try {
      const { Result } = req.models;
      const id = String(req.params.id || "").trim();
      if (!isId(id)) throw new Error("Invalid result id.");
      const current = await Result.findOne({ _id: id, migrationQuarantinedAt: null }).lean();
      if (!current) throw new Error("Result not found.");
      assertDeleteAllowed(current);
      const write = await Result.deleteOne({ _id: id, status: "draft", updatedAt: current.updatedAt, firstPublishedAt: null });
      if (!write.deletedCount) throw new Error("This result changed in another session. Reload before deleting.");
      req.flash?.("success", "Draft result deleted.");
    } catch (err) {
      console.error("DELETE RESULT ERROR:", err);
      flashError(req, err, "Failed to delete result.");
    }
    return res.redirect("/admin/results");
  },

  bulk: async (req, res) => {
    try {
      const { Result, Exam } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = [...new Set(String(req.body.ids || "").split(",").map((x) => x.trim()).filter((x) => isId(x)))].slice(0, 5000);
      if (!ids.length) throw new Error("No results selected.");
      if (!["publish", "draft", "delete"].includes(action)) throw new Error("Invalid bulk action.");
      const rows = await Result.find({ _id: { $in: ids }, migrationQuarantinedAt: null }).lean();
      if (rows.length !== ids.length) throw new Error("One or more selected results no longer exist. Reload and try again.");
      const exams = action === "delete" ? [] : await Exam.find({ _id: { $in: [...new Set(rows.map((r) => String(r.exam)))] } }).select("status").lean();
      const examMap = new Map(exams.map((e) => [String(e._id), e]));
      await applyBulkWithCompensation(req, rows, action, examMap);
      req.flash?.("success", action === "publish" ? "Selected results published." : action === "draft" ? "Selected results reopened as Draft." : "Selected draft results deleted.");
    } catch (err) {
      console.error("RESULT BULK ERROR:", err);
      flashError(req, err, "Bulk action failed.");
    }
    return res.redirect("/admin/results");
  },

  importCsv: async (req, res) => {
    try {
      const { Result, Exam, Student } = req.models;
      if (!req.file?.buffer) throw new Error("Please choose a CSV file.");
      if (!/\.csv$/i.test(String(req.file.originalname || "")) || !isProbablyCsvText(req.file.buffer)) throw new Error("The uploaded file is not a valid text CSV file.");
      const rows = parseCsvBuffer(req.file.buffer);
      if (rows.length < 2) throw new Error("CSV file is empty or invalid.");
      const header = rows[0].map((x) => String(x || "").trim().toLowerCase());
      const idx = { examId: header.indexOf("examid"), studentId: header.indexOf("studentid"), score: header.indexOf("score"), grade: header.indexOf("grade"), remark: header.indexOf("remark"), status: header.indexOf("status") };
      if (idx.examId < 0 || idx.studentId < 0 || idx.score < 0) throw new Error("CSV must include examId, studentId and score columns.");
      if (rows.length - 1 > 3000) throw new Error("CSV import is limited to 3,000 result rows per file.");
      const bodyRows = rows.slice(1);
      if (!bodyRows.length) throw new Error("No import rows found.");

      const parsed = bodyRows.map((row, i) => ({
        rowNumber: i + 2,
        examId: String(row[idx.examId] || "").trim(),
        studentId: String(row[idx.studentId] || "").trim(),
        score: row[idx.score],
        grade: idx.grade >= 0 ? String(row[idx.grade] || "").trim() : "",
        remark: idx.remark >= 0 ? String(row[idx.remark] || "").trim() : "",
        status: idx.status >= 0 ? String(row[idx.status] || "").trim().toLowerCase() || "draft" : "draft",
      }));
      const errors = [];
      const seenPairs = new Set();
      for (const row of parsed) {
        if (!isId(row.examId) || !isId(row.studentId)) errors.push(`row ${row.rowNumber}: invalid examId or studentId`);
        if (!["draft", "published"].includes(row.status)) errors.push(`row ${row.rowNumber}: status must be draft or published`);
        const pair = `${row.examId}|${row.studentId}`;
        if (seenPairs.has(pair)) errors.push(`row ${row.rowNumber}: duplicate examId/studentId pair in this CSV`);
        seenPairs.add(pair);
      }
      if (errors.length) throw new Error(`Import rejected before writing. ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? `; and ${errors.length - 8} more` : ""}.`);

      const examIds = [...new Set(parsed.map((r) => r.examId))];
      const studentIds = [...new Set(parsed.map((r) => r.studentId))];
      const [exams, students, existing] = await Promise.all([
        Exam.find({ _id: { $in: examIds } }).select(examSelect).lean(),
        Student.find({ _id: { $in: studentIds } }).select(studentSelect).lean(),
        Result.find({ exam: { $in: examIds }, student: { $in: studentIds }, migrationQuarantinedAt: null }).select("exam student").lean(),
      ]);
      const examMap = new Map(exams.map((e) => [String(e._id), e]));
      const studentMap = new Map(students.map((s) => [String(s._id), s]));
      const existingPairs = new Set(existing.map((r) => `${String(r.exam)}|${String(r.student)}`));
      const prepared = [];
      for (const row of parsed) {
        try {
          const exam = examMap.get(row.examId);
          const student = studentMap.get(row.studentId);
          if (!exam) throw new Error("exam not found");
          if (!student) throw new Error("student not found");
          if (existingPairs.has(`${row.examId}|${row.studentId}`)) throw new Error("result already exists for this exam/student");
          prepared.push(buildResultValues({ exam, student, score: row.score, grade: row.grade, remark: row.remark, status: row.status, actorId: req.user?._id || null }));
        } catch (err) { errors.push(`row ${row.rowNumber}: ${err.message}`); }
      }
      if (errors.length) throw new Error(`Import rejected before writing. ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? `; and ${errors.length - 8} more` : ""}.`);
      const created = await insertPreparedWithCompensation(req, prepared);
      req.flash?.("success", `Import completed. Created ${created} result(s).`);
    } catch (err) {
      console.error("IMPORT RESULT CSV ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "Import aborted because a result was created concurrently for one of the exam/student pairs.");
      else flashError(req, err, "Failed to import CSV.");
    }
    return res.redirect("/admin/results");
  },

  exportCsv: async (req, res) => {
    try {
      const { Result } = req.models;
      const parsed = buildFilterPayload(req);
      await attachSearchFilter(req.models, parsed.q, parsed.filter);
      let query = Result.find(parsed.filter);
      for (const pop of buildResultPopulate(req.models)) query = query.populate(pop);
      const rows = await query.sort({ updatedAt: -1 }).limit(50000).lean();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="results_export.csv"');
      const header = ["Exam", "Student", "RegNo", "Class", "Section", "Stream", "Subject", "AcademicYear", "Term", "TotalMarks", "Score", "Percentage", "Grade", "Remark", "Status", "PublishedAt", "UpdatedAt"];
      res.write(header.map(csvCell).join(",") + "\n");
      for (const r of rows) {
        const s = r.student || {};
        const line = [
          r.exam?.title || "", s.fullName || s.name || "", s.regNo || s.studentNo || s.studentNumber || s.indexNumber || "",
          r.classGroup?.name || r.classGroup?.title || r.classGroup?.code || "", r.sectionName || r.sectionId?.name || r.sectionId?.code || "",
          r.streamName || r.streamId?.name || r.streamId?.code || "", r.subject ? `${r.subject.code || ""}${r.subject.code ? " — " : ""}${r.subject.title || ""}`.trim() : "",
          r.academicYear || "", r.term || "", r.totalMarks ?? "", r.score ?? "", r.percentage ?? "", r.grade || "", r.remark || "", r.status || "",
          r.publishedAt ? new Date(r.publishedAt).toISOString() : "", r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
        ];
        res.write(line.map(csvCell).join(",") + "\n");
      }
      return res.end();
    } catch (err) {
      console.error("EXPORT CSV ERROR:", err);
      return res.status(500).send("Failed to export CSV.");
    }
  },

  _test: { parseCsvBuffer, isProbablyCsvText, buildFilterPayload, attachSearchFilter, insertPreparedWithCompensation, buildBulkOperations, applyBulkWithCompensation },
};
