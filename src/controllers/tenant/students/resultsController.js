const {
  getStudent,
  mustHaveStudent,
  getStudentDisplayName,
  academicMeta,
  renderView,
} = require("./_helpers");
const { studentPublishedResultFilter } = require("../../../services/tenant/resultService");

function normalizedRow(r, meta = {}) {
  const subject = r.subject || {};
  const exam = r.exam || {};
  const totalMarks = Number(r.totalMarks || exam.maxMarks || 100);
  const score = Number(r.score || 0);
  const percentage = Number.isFinite(Number(r.percentage))
    ? Number(r.percentage)
    : totalMarks > 0
      ? Math.round((score / totalMarks) * 10000) / 100
      : 0;
  const passMark = Number.isFinite(Number(r.passMark)) ? Number(r.passMark) : Number(exam.passMark || 50);
  return {
    id: String(r._id || ""),
    examTitle: exam.title || "Exam",
    examCode: exam.code || "",
    subjectCode: subject.code || "",
    subjectTitle: subject.title || subject.shortTitle || "Subject",
    academicYear: r.academicYear || meta.academicYear || "",
    term: Number(r.term || meta.term || 1),
    totalMarks,
    passMark,
    score,
    percentage,
    grade: r.grade || "—",
    remark: r.remark || "—",
    passed: score >= passMark,
    publishedAt: r.publishedAt || null,
  };
}

module.exports = {
  results: async (req, res) => {
    try {
      if (!req.models) return res.status(500).send("Tenant models not loaded");
      const { Result, Exam, Subject } = req.models;
      const got = await getStudent(req);
      const user = got?.user || null;
      const student = got?.student || null;
      if (!user) return res.redirect("/login");

      const blocked = mustHaveStudent(
        res,
        { tenant: req.tenant, user, student, currentPath: req.originalUrl, pageTitle: "Results" },
        "students/results"
      );
      if (blocked) return blocked;

      const meta = academicMeta(student);
      let query = Result.find(studentPublishedResultFilter(student._id));
      if (Exam) query = query.populate({ path: "exam", model: Exam, select: "title code maxMarks passMark status" });
      if (Subject) query = query.populate({ path: "subject", model: Subject, select: "code title shortTitle" });
      const results = await query
        .sort({ academicYear: -1, term: -1, publishedAt: -1, createdAt: -1 })
        .lean();
      const rows = results.map((r) => normalizedRow(r, meta));
      const summary = {
        totalResults: rows.length,
        passed: rows.filter((r) => r.passed).length,
        failed: rows.filter((r) => !r.passed).length,
        average: rows.length ? Math.round((rows.reduce((sum, r) => sum + r.percentage, 0) / rows.length) * 100) / 100 : 0,
      };

      return renderView(req, res, "students/results", {
        pageTitle: "Results",
        user,
        student,
        studentName: getStudentDisplayName(student, user),
        meta,
        results: rows,
        summary,
      });
    } catch (err) {
      console.error("STUDENT RESULTS ERROR:", err);
      return res.status(500).send("Failed to load results.");
    }
  },
  _test: { normalizedRow },
};
