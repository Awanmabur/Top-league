const { getParent, canAccessChild, renderError } = require("./_helpers");

function buildTermSummary(rows = []) {
  const total = rows.length;
  if (!total) {
    return {
      totalSubjects: 0,
      averageScore: 0,
      passed: 0,
      failed: 0,
      bestSubject: null,
      weakestSubject: null,
    };
  }

  const normalized = rows.map((r) => ({
    ...r,
    score: Number(r.totalScore ?? r.score ?? r.mark ?? r.marks ?? 0),
    grade: r.grade || "—",
    subject: r.subjectName || r.subject || r.courseName || r.course || "Subject",
    remarks: r.remarks || r.comment || "—",
    passMark: Number(r.passMark ?? 50),
  }));

  const totalScore = normalized.reduce((sum, r) => sum + Number(r.score || 0), 0);
  const averageScore = Math.round(totalScore / normalized.length);

  const passed = normalized.filter((r) => Number(r.score) >= Number(r.passMark || 50)).length;
  const failed = normalized.length - passed;

  const sorted = [...normalized].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  return {
    totalSubjects: normalized.length,
    averageScore,
    passed,
    failed,
    bestSubject: sorted[0] || null,
    weakestSubject: sorted[sorted.length - 1] || null,
    rows: normalized,
  };
}

function buildRecentPerformance(rows = []) {
  return rows
    .slice(0, 8)
    .map((r) => ({
      exam: r.examTitle || r.assessment || r.exam || "Assessment",
      subject: r.subjectName || r.subject || r.courseName || r.course || "Subject",
      score: Number(r.totalScore ?? r.score ?? r.mark ?? r.marks ?? 0),
      grade: r.grade || "—",
      date: r.publishedAt
        ? new Date(r.publishedAt).toLocaleDateString()
        : r.createdAt
          ? new Date(r.createdAt).toLocaleDateString()
          : "—",
      remarks: r.remarks || r.comment || "—",
    }));
}

module.exports = {
  async index(req, res) {
    const log = (...a) =>
      console.log(
        `[PARENT-RESULTS] tenant=${req.tenant?.code || req.tenant?._id || "?"}`,
        ...a
      );

    try {
      const { Student, Result, Exam, Program, ClassGroup } = req.models || {};

      const { user, parent } = await getParent(req);
      if (!user) return res.redirect("/login");

      const childIds = Array.isArray(parent?.childrenStudentIds)
        ? parent.childrenStudentIds
        : [];

      const children =
        parent && Student && childIds.length
          ? await Student.find({ _id: { $in: childIds } })
              .select(
                "firstName lastName middleName fullName regNo program classGroup yearLevel academicYear semester status"
              )
              .populate({ path: "program", select: "code name title level faculty" })
              .populate({ path: "classGroup", select: "code name title" })
              .sort({ firstName: 1, lastName: 1 })
              .lean()
              .catch(() => [])
          : [];

      const selectedStudentId = req.query?.student ? String(req.query.student) : null;

      let student = null;
      if (selectedStudentId && canAccessChild(parent, selectedStudentId)) {
        student = children.find((c) => String(c._id) === selectedStudentId) || null;
      }
      if (!student && children.length) student = children[0];

      if (!student) {
        return res.render("parents/results", {
          tenant: req.tenant,
          user,
          parent,
          children,
          student: null,
          resultRows: [],
          recentPerformance: [],
          resultSummary: {
            totalSubjects: 0,
            averageScore: 0,
            passed: 0,
            failed: 0,
            bestSubject: null,
            weakestSubject: null,
          },
          filters: {
            academicYear: req.query?.academicYear || "",
            semester: req.query?.semester || "",
          },
          error: "No linked student found for this parent account.",
        });
      }

      const academicYearFilter = String(req.query?.academicYear || "").trim();
      const semesterFilter = String(req.query?.semester || "").trim();

      const resultQuery = {
        deletedAt: null,
        $or: [{ student: student._id }, { studentId: student._id }],
      };

      if (academicYearFilter) resultQuery.academicYear = academicYearFilter;
      if (semesterFilter) resultQuery.semester = semesterFilter;

      const resultRows = Result
        ? await Result.find(resultQuery)
            .populate({ path: "exam", select: "title name type term semester academicYear" })
            .sort({ publishedAt: -1, createdAt: -1 })
            .lean()
            .catch(() => [])
        : [];

      const resultSummary = buildTermSummary(resultRows);
      const recentPerformance = buildRecentPerformance(resultRows);

      const availableAcademicYears = [
        ...new Set(
          resultRows
            .map((r) => String(r.academicYear || "").trim())
            .filter(Boolean)
        ),
      ];

      const availableSemesters = [
        ...new Set(
          resultRows
            .map((r) => String(r.semester || "").trim())
            .filter(Boolean)
        ),
      ];

      log(
        "user:",
        user ? { id: user._id, email: user.email, roles: user.roles } : null
      );
      log(
        "parent:",
        parent
          ? { id: parent._id, email: parent.email, kids: (parent.childrenStudentIds || []).length }
          : null
      );
      log("children:", children.length);
      log("selectedStudent:", student ? String(student._id) : null);
      log("results:", resultRows.length);

      return res.render("parents/results", {
        tenant: req.tenant,
        user,
        parent,
        children,
        student,
        resultRows: resultSummary.rows || [],
        recentPerformance,
        resultSummary,
        filters: {
          academicYear: academicYearFilter,
          semester: semesterFilter,
        },
        options: {
          academicYears: availableAcademicYears,
          semesters: availableSemesters,
        },
        error: null,
      });
    } catch (err) {
      console.error("PARENT RESULTS ERROR:", err);
      return res.status(500).send("Failed to load parent results page");
    }
  },
};