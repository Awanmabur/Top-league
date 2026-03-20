const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || "").trim());

function clampNum(n, min, max, fallback = 0) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(x, max));
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function parseCsvBuffer(buffer) {
  const text = String(buffer || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell.trim());
        cell = "";
      } else if (ch === "\n") {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
  }

  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((x) => String(x || "").trim() !== ""));
}

function defaultGrading(percentage) {
  const p = clampNum(percentage, 0, 100, 0);

  if (p >= 80) return { grade: "A", remark: "Excellent" };
  if (p >= 75) return { grade: "A-", remark: "Very Good" };
  if (p >= 70) return { grade: "B+", remark: "Very Good" };
  if (p >= 65) return { grade: "B", remark: "Good" };
  if (p >= 60) return { grade: "B-", remark: "Good" };
  if (p >= 55) return { grade: "C+", remark: "Satisfactory" };
  if (p >= 50) return { grade: "C", remark: "Satisfactory" };
  if (p >= 45) return { grade: "C-", remark: "Pass" };
  if (p >= 40) return { grade: "D", remark: "Pass" };
  return { grade: "F", remark: "Fail" };
}

const resultRules = [
  body("exam").custom((v) => isId(v)).withMessage("Exam is required."),
  body("student").custom((v) => isId(v)).withMessage("Student is required."),
  body("score").optional({ checkFalsy: false }).isFloat({ min: 0, max: 100000 }).toFloat(),
  body("grade").optional({ checkFalsy: true }).trim().isLength({ max: 10 }),
  body("remark").optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body("status").optional({ checkFalsy: true }).isIn(["draft", "published"]).withMessage("Invalid status."),
];

function normalizeResultCard(r) {
  const s = r.student || {};
  const e = r.exam || {};
  const regNo = s.regNo || s.studentNumber || s.indexNumber || "";

  return {
    id: String(r._id || ""),
    examId: e._id ? String(e._id) : "",
    examTitle: e.title || "",
    studentId: s._id ? String(s._id) : "",
    studentName: s.fullName || s.name || "Student",
    regNo,
    className: r.classGroup?.name || r.classGroup?.title || r.classGroup?.code || "",
    courseInfo: r.course ? `${r.course.code || ""}${r.course.code ? " — " : ""}${r.course.title || ""}`.trim() : "",
    programInfo: r.program ? `${r.program.code || ""}${r.program.code ? " — " : ""}${r.program.name || ""}`.trim() : "",
    academicYear: r.academicYear || "",
    semester: Number(r.semester || 1),
    totalMarks: Number(r.totalMarks ?? 100),
    score: Number(r.score ?? 0),
    percentage: Number(r.percentage ?? 0),
    grade: r.grade || "",
    remark: r.remark || "",
    status: r.status || "draft",
    enteredBy: r.enteredBy?.fullName || r.enteredBy?.name || "",
    publishedAt: r.publishedAt ? new Date(r.publishedAt).toLocaleString() : "",
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "",
  };
}

function buildFilterPayload(req) {
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim();
  const exam = String(req.query.exam || "").trim();
  const classGroup = String(req.query.classGroup || "").trim();
  const course = String(req.query.course || "").trim();
  const program = String(req.query.program || "").trim();
  const academicYear = String(req.query.academicYear || "").trim();
  const semester = String(req.query.semester || "").trim();
  const grade = String(req.query.grade || "").trim();
  const minScore = String(req.query.minScore || "").trim();
  const maxScore = String(req.query.maxScore || "").trim();

  const filter = {};
  if (status) filter.status = status;
  if (grade) filter.grade = grade;
  if (academicYear) filter.academicYear = academicYear;
  if (semester && Number.isFinite(Number(semester))) filter.semester = Number(semester);
  if (exam && isId(exam)) filter.exam = exam;
  if (classGroup && isId(classGroup)) filter.classGroup = classGroup;
  if (course && isId(course)) filter.course = course;
  if (program && isId(program)) filter.program = program;
  if (minScore && Number.isFinite(Number(minScore))) filter.score = { ...(filter.score || {}), $gte: Number(minScore) };
  if (maxScore && Number.isFinite(Number(maxScore))) filter.score = { ...(filter.score || {}), $lte: Number(maxScore) };

  return { q, status, exam, classGroup, course, program, academicYear, semester, grade, minScore, maxScore, filter };
}

async function attachSearchFilter(models, q, filter) {
  if (!q) return filter;

  const { Student, Exam } = models;

  const [studentHits, examHits] = await Promise.all([
    Student.find({
      isDeleted: { $ne: true },
      $or: [
        { fullName: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
        { regNo: { $regex: q, $options: "i" } },
        { studentNumber: { $regex: q, $options: "i" } },
        { indexNumber: { $regex: q, $options: "i" } },
      ],
    }).select("_id").limit(2000).lean(),
    Exam.find({ title: { $regex: q, $options: "i" } }).select("_id").limit(2000).lean(),
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
  const { Exam, Student, Course, Program, Class, User, Staff, Admin } = models;

  const populate = [
    { path: "exam", model: Exam, select: "title totalMarks academicYear semester" },
    { path: "student", model: Student, select: "fullName name regNo studentNumber indexNumber" },
    { path: "course", model: Course, select: "title code" },
    { path: "program", model: Program, select: "name code" },
    { path: "classGroup", model: Class, select: "name title code" },
  ];

  // Optional enteredBy model resolution
  const actorModel = User || Staff || Admin;
  if (actorModel) {
    populate.push({
      path: "enteredBy",
      model: actorModel,
      select: "fullName name email",
    });
  }

  return populate;
}

module.exports = {
  resultRules,

  options: async (req, res) => {
    try {
      const { Exam, Student, Course, Program, Class } = req.models;
      const examId = String(req.query.exam || "").trim();
      if (!isId(examId)) return res.json({ ok: false, message: "Invalid exam id." });

      const exam = await Exam.findById(examId)
        .select("title classGroup course program academicYear semester totalMarks")
        .lean();

      if (!exam) return res.json({ ok: false, message: "Exam not found." });

      const studentFilter = { isDeleted: { $ne: true } };
      if (exam.classGroup) studentFilter.classGroup = exam.classGroup;

      const students = await Student.find(studentFilter)
        .select("fullName name regNo studentNumber indexNumber")
        .sort({ fullName: 1, name: 1 })
        .limit(2000)
        .lean();

      const classDoc = exam.classGroup ? await Class.findById(exam.classGroup).select("name title code").lean() : null;
      const courseDoc = exam.course ? await Course.findById(exam.course).select("title code").lean() : null;
      const programDoc = exam.program ? await Program.findById(exam.program).select("name code").lean() : null;

      return res.json({
        ok: true,
        exam: {
          _id: exam._id,
          title: exam.title || "",
          classGroup: exam.classGroup || null,
          course: exam.course || null,
          program: exam.program || null,
          academicYear: exam.academicYear || "",
          semester: exam.semester || 1,
          totalMarks: exam.totalMarks ?? 100,
        },
        labels: {
          classGroup: classDoc?.name || classDoc?.title || classDoc?.code || "",
          course: courseDoc ? `${courseDoc.code || ""}${courseDoc.code ? " — " : ""}${courseDoc.title || ""}`.trim() : "",
          program: programDoc ? `${programDoc.code || ""}${programDoc.code ? " — " : ""}${programDoc.name || ""}`.trim() : "",
        },
        students: students.map((s) => ({
          _id: s._id,
          fullName: s.fullName || s.name || "Student",
          regNo: s.regNo || s.studentNumber || s.indexNumber || "",
        })),
      });
    } catch (err) {
      console.error("RESULT OPTIONS ERROR:", err);
      return res.json({ ok: false, message: "Failed to load options." });
    }
  },

  list: async (req, res) => {
    try {
      const { Result, Exam, Student, Course, Program, Class } = req.models;
      const parsed = buildFilterPayload(req);
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const perPage = 10;

      await attachSearchFilter(req.models, parsed.q, parsed.filter);

      const total = await Result.countDocuments(parsed.filter);
      const totalPages = Math.max(Math.ceil(total / perPage), 1);
      const safePage = Math.min(page, totalPages);

      let query = Result.find(parsed.filter);
      for (const pop of buildResultPopulate(req.models)) {
        query = query.populate(pop);
      }

      const results = await query
        .sort({ updatedAt: -1, _id: -1 })
        .skip((safePage - 1) * perPage)
        .limit(perPage)
        .lean();

      const [exams, classes, courses, programs, published, draft] = await Promise.all([
        Exam.find({}).select("title").sort({ createdAt: -1 }).limit(300).lean(),
        Class.find({}).select("name title code").sort({ name: 1, title: 1 }).limit(300).lean(),
        Course.find({}).select("title code").sort({ title: 1 }).limit(500).lean(),
        Program.find({}).select("name code").sort({ name: 1 }).limit(300).lean(),
        Result.countDocuments({ ...parsed.filter, status: "published" }),
        Result.countDocuments({ ...parsed.filter, status: "draft" }),
      ]);

      const avgScore = results.length
        ? Math.round((results.reduce((a, x) => a + (Number(x.score) || 0), 0) / results.length) * 100) / 100
        : 0;

      const resultsData = results.map(normalizeResultCard);

      const exportParams = new URLSearchParams();
      Object.entries(parsed).forEach(([k, v]) => {
        if (k === "filter") return;
        if (v !== undefined && v !== null && String(v) !== "") exportParams.set(k, String(v));
      });

      function buildPageUrl(targetPage) {
        const params = new URLSearchParams();
        Object.entries(parsed).forEach(([k, v]) => {
          if (k === "filter") return;
          if (v !== undefined && v !== null && String(v) !== "") params.set(k, String(v));
        });
        params.set("page", String(targetPage));
        return `/admin/results?${params.toString()}`;
      }

      return res.render("tenant/admin/results/index", {
        tenant: req.tenant || null,
        results,
        resultsData,
        exams,
        classes,
        courses,
        programs,
        csrfToken: res.locals.csrfToken || null,
        kpis: {
          total,
          published,
          draft,
          avgScore,
        },
        query: {
          ...parsed,
          page: safePage,
          total,
          totalPages,
          perPage,
        },
        exportQueryString: exportParams.toString(),
        pagination: {
          startPage: Math.max(1, safePage - 2),
          endPage: Math.min(totalPages, safePage + 2),
        },
        buildPageUrl,
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("RESULTS LIST ERROR:", err);
      return res.status(500).send("Failed to load results.");
    }
  },

  create: async (req, res) => {
    const { Result, Exam, Student } = req.models;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/results");
    }

    try {
      const examId = String(req.body.exam || "").trim();
      const studentId = String(req.body.student || "").trim();

      const [exam, student] = await Promise.all([
        Exam.findById(examId).select("classGroup course program academicYear semester totalMarks").lean(),
        Student.findById(studentId).select("classGroup").lean(),
      ]);

      if (!exam) {
        req.flash?.("error", "Exam not found.");
        return res.redirect("/admin/results");
      }

      if (!student) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/results");
      }

      if (student.classGroup && exam.classGroup && String(student.classGroup) !== String(exam.classGroup)) {
        req.flash?.("error", "Student is not in the selected exam class.");
        return res.redirect("/admin/results");
      }

      const totalMarks = clampNum(exam.totalMarks ?? 100, 0, 100000, 100);
      const score = clampNum(req.body.score ?? 0, 0, 100000, 0);
      const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;
      const auto = defaultGrading(percentage);
      const status = ["draft", "published"].includes(req.body.status) ? req.body.status : "draft";

      await Result.create({
        exam: examId,
        student: studentId,
        classGroup: exam.classGroup || null,
        course: exam.course || null,
        program: exam.program || null,
        academicYear: String(exam.academicYear || "").trim(),
        semester: clampNum(exam.semester ?? 1, 1, 6, 1),
        totalMarks,
        score,
        percentage,
        grade: String(req.body.grade || "").trim() || auto.grade,
        remark: String(req.body.remark || "").trim() || auto.remark,
        status,
        enteredBy: req.user?._id || null,
        publishedAt: status === "published" ? new Date() : null,
      });

      req.flash?.("success", "Result saved.");
      return res.redirect("/admin/results");
    } catch (err) {
      console.error("CREATE RESULT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "This student already has a result for this exam.");
      else req.flash?.("error", "Failed to save result.");
      return res.redirect("/admin/results");
    }
  },

  update: async (req, res) => {
    const { Result, Exam, Student } = req.models;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      req.flash?.("error", errors.array().map((e) => e.msg).join(" "));
      return res.redirect("/admin/results");
    }

    try {
      const id = String(req.params.id || "").trim();
      if (!isId(id)) {
        req.flash?.("error", "Invalid result id.");
        return res.redirect("/admin/results");
      }

      const examId = String(req.body.exam || "").trim();
      const studentId = String(req.body.student || "").trim();

      const [exam, student, collision] = await Promise.all([
        Exam.findById(examId).select("classGroup course program academicYear semester totalMarks").lean(),
        Student.findById(studentId).select("classGroup").lean(),
        Result.findOne({ exam: examId, student: studentId, _id: { $ne: id } }).select("_id").lean(),
      ]);

      if (!exam) {
        req.flash?.("error", "Exam not found.");
        return res.redirect("/admin/results");
      }

      if (!student) {
        req.flash?.("error", "Student not found.");
        return res.redirect("/admin/results");
      }

      if (collision) {
        req.flash?.("error", "This student already has a result for this exam.");
        return res.redirect("/admin/results");
      }

      if (student.classGroup && exam.classGroup && String(student.classGroup) !== String(exam.classGroup)) {
        req.flash?.("error", "Student is not in the selected exam class.");
        return res.redirect("/admin/results");
      }

      const totalMarks = clampNum(exam.totalMarks ?? 100, 0, 100000, 100);
      const score = clampNum(req.body.score ?? 0, 0, 100000, 0);
      const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;
      const auto = defaultGrading(percentage);
      const status = ["draft", "published"].includes(req.body.status) ? req.body.status : "draft";

      await Result.updateOne(
        { _id: id },
        {
          $set: {
            exam: examId,
            student: studentId,
            classGroup: exam.classGroup || null,
            course: exam.course || null,
            program: exam.program || null,
            academicYear: String(exam.academicYear || "").trim(),
            semester: clampNum(exam.semester ?? 1, 1, 6, 1),
            totalMarks,
            score,
            percentage,
            grade: String(req.body.grade || "").trim() || auto.grade,
            remark: String(req.body.remark || "").trim() || auto.remark,
            status,
            enteredBy: status === "published" ? (req.user?._id || null) : undefined,
            publishedAt: status === "published" ? new Date() : null,
          },
        },
        { runValidators: true }
      );

      req.flash?.("success", "Result updated.");
      return res.redirect("/admin/results");
    } catch (err) {
      console.error("UPDATE RESULT ERROR:", err);
      if (String(err?.code) === "11000") req.flash?.("error", "This student already has a result for this exam.");
      else req.flash?.("error", "Failed to update result.");
      return res.redirect("/admin/results");
    }
  },

  setStatus: async (req, res) => {
    try {
      const { Result } = req.models;
      const id = String(req.params.id || "").trim();

      if (!isId(id)) {
        req.flash?.("error", "Invalid result id.");
        return res.redirect("/admin/results");
      }

      const next = ["draft", "published"].includes(req.body.status) ? req.body.status : null;
      if (!next) {
        req.flash?.("error", "Invalid status.");
        return res.redirect("/admin/results");
      }

      const update = {
        status: next,
        publishedAt: next === "published" ? new Date() : null,
      };
      if (next === "published") update.enteredBy = req.user?._id || null;

      await Result.updateOne({ _id: id }, { $set: update });

      req.flash?.("success", "Status updated.");
      return res.redirect("/admin/results");
    } catch (err) {
      console.error("SET RESULT STATUS ERROR:", err);
      req.flash?.("error", "Failed to update status.");
      return res.redirect("/admin/results");
    }
  },

  remove: async (req, res) => {
    try {
      const { Result } = req.models;
      const id = String(req.params.id || "").trim();

      if (!isId(id)) {
        req.flash?.("error", "Invalid result id.");
        return res.redirect("/admin/results");
      }

      await Result.deleteOne({ _id: id });
      req.flash?.("success", "Result deleted.");
      return res.redirect("/admin/results");
    } catch (err) {
      console.error("DELETE RESULT ERROR:", err);
      req.flash?.("error", "Failed to delete result.");
      return res.redirect("/admin/results");
    }
  },

  bulk: async (req, res) => {
    try {
      const { Result } = req.models;
      const action = String(req.body.action || "").trim();
      const ids = String(req.body.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => isId(x))
        .slice(0, 5000);

      if (!ids.length) {
        req.flash?.("error", "No results selected.");
        return res.redirect("/admin/results");
      }

      if (action === "publish") {
        await Result.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "published", enteredBy: req.user?._id || null, publishedAt: new Date() } }
        );
        req.flash?.("success", "Selected results published.");
      } else if (action === "draft") {
        await Result.updateMany(
          { _id: { $in: ids } },
          { $set: { status: "draft", publishedAt: null } }
        );
        req.flash?.("success", "Selected results set to draft.");
      } else if (action === "delete") {
        await Result.deleteMany({ _id: { $in: ids } });
        req.flash?.("success", "Selected results deleted.");
      } else {
        req.flash?.("error", "Invalid bulk action.");
      }

      return res.redirect("/admin/results");
    } catch (err) {
      console.error("RESULT BULK ERROR:", err);
      req.flash?.("error", "Bulk action failed.");
      return res.redirect("/admin/results");
    }
  },

  importCsv: async (req, res) => {
    try {
      const { Result, Exam, Student } = req.models;

      if (!req.file || !req.file.buffer) {
        req.flash?.("error", "Please choose a CSV file.");
        return res.redirect("/admin/results");
      }

      const rows = parseCsvBuffer(req.file.buffer);
      if (rows.length < 2) {
        req.flash?.("error", "CSV file is empty or invalid.");
        return res.redirect("/admin/results");
      }

      const header = rows[0].map((x) => String(x || "").trim().toLowerCase());
      const idx = {
        examId: header.indexOf("examid"),
        studentId: header.indexOf("studentid"),
        score: header.indexOf("score"),
        grade: header.indexOf("grade"),
        remark: header.indexOf("remark"),
        status: header.indexOf("status"),
      };

      if (idx.examId < 0 || idx.studentId < 0 || idx.score < 0) {
        req.flash?.("error", "CSV must include examId, studentId and score columns.");
        return res.redirect("/admin/results");
      }

      const bodyRows = rows.slice(1).slice(0, 3000);
      if (!bodyRows.length) {
        req.flash?.("error", "No import rows found.");
        return res.redirect("/admin/results");
      }

      let created = 0;
      let failed = 0;

      for (const row of bodyRows) {
        try {
          const examId = String(row[idx.examId] || "").trim();
          const studentId = String(row[idx.studentId] || "").trim();
          const rawScore = row[idx.score];
          const rawGrade = idx.grade >= 0 ? String(row[idx.grade] || "").trim() : "";
          const rawRemark = idx.remark >= 0 ? String(row[idx.remark] || "").trim() : "";
          const rawStatus = idx.status >= 0 ? String(row[idx.status] || "").trim().toLowerCase() : "draft";

          if (!isId(examId) || !isId(studentId)) {
            failed += 1;
            continue;
          }

          const [exam, student, exists] = await Promise.all([
            Exam.findById(examId).select("classGroup course program academicYear semester totalMarks").lean(),
            Student.findById(studentId).select("classGroup").lean(),
            Result.findOne({ exam: examId, student: studentId }).select("_id").lean(),
          ]);

          if (!exam || !student || exists) {
            failed += 1;
            continue;
          }

          if (student.classGroup && exam.classGroup && String(student.classGroup) !== String(exam.classGroup)) {
            failed += 1;
            continue;
          }

          const totalMarks = clampNum(exam.totalMarks ?? 100, 0, 100000, 100);
          const score = clampNum(rawScore, 0, 100000, 0);
          const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;
          const auto = defaultGrading(percentage);
          const status = rawStatus === "published" ? "published" : "draft";

          await Result.create({
            exam: examId,
            student: studentId,
            classGroup: exam.classGroup || null,
            course: exam.course || null,
            program: exam.program || null,
            academicYear: String(exam.academicYear || "").trim(),
            semester: clampNum(exam.semester ?? 1, 1, 6, 1),
            totalMarks,
            score,
            percentage,
            grade: rawGrade || auto.grade,
            remark: rawRemark || auto.remark,
            status,
            enteredBy: req.user?._id || null,
            publishedAt: status === "published" ? new Date() : null,
          });

          created += 1;
        } catch (err) {
          failed += 1;
        }
      }

      req.flash?.("success", `Import completed. Created ${created} result(s). Failed ${failed}.`);
      return res.redirect("/admin/results");
    } catch (err) {
      console.error("IMPORT RESULT CSV ERROR:", err);
      req.flash?.("error", "Failed to import CSV.");
      return res.redirect("/admin/results");
    }
  },

  exportCsv: async (req, res) => {
    try {
      const { Result } = req.models;
      const parsed = buildFilterPayload(req);
      await attachSearchFilter(req.models, parsed.q, parsed.filter);

      let query = Result.find(parsed.filter);
      for (const pop of buildResultPopulate(req.models)) {
        query = query.populate(pop);
      }

      const rows = await query
        .sort({ updatedAt: -1 })
        .limit(50000)
        .lean();

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="results_export.csv"');

      const header = [
        "Exam",
        "Student",
        "RegNo",
        "Class",
        "Course",
        "Program",
        "AcademicYear",
        "Semester",
        "TotalMarks",
        "Score",
        "Percentage",
        "Grade",
        "Remark",
        "Status",
        "PublishedAt",
        "UpdatedAt",
      ];

      res.write(header.map(csvEscape).join(",") + "\n");

      for (const r of rows) {
        const s = r.student || {};
        const regNo = s.regNo || s.studentNumber || s.indexNumber || "";
        const line = [
          r.exam?.title || "",
          s.fullName || s.name || "",
          regNo,
          r.classGroup?.name || r.classGroup?.title || r.classGroup?.code || "",
          r.course ? `${r.course.code || ""}${r.course.code ? " — " : ""}${r.course.title || ""}`.trim() : "",
          r.program ? `${r.program.code || ""}${r.program.code ? " — " : ""}${r.program.name || ""}`.trim() : "",
          r.academicYear || "",
          r.semester || "",
          r.totalMarks ?? "",
          r.score ?? "",
          r.percentage ?? "",
          r.grade || "",
          r.remark || "",
          r.status || "",
          r.publishedAt ? new Date(r.publishedAt).toISOString() : "",
          r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
        ];
        res.write(line.map(csvEscape).join(",") + "\n");
      }

      return res.end();
    } catch (err) {
      console.error("EXPORT CSV ERROR:", err);
      return res.status(500).send("Failed to export CSV.");
    }
  },
};