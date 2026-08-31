const RESULT_STATUSES = new Set(["draft", "published"]);
const RESULT_ENTRY_EXAM_STATUSES = new Set(["scheduled", "completed"]);

const str = (v, max = 300) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => {
  if (!v) return "";
  if (typeof v === "object" && v._id) return String(v._id);
  return String(v);
};
const sameId = (a, b) => idText(a) === idText(b);

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeResultStatus(value, fallback = "draft") {
  const status = str(value, 20).toLowerCase();
  if (!status) return fallback;
  if (!RESULT_STATUSES.has(status)) throw new Error("Invalid result status.");
  return status;
}

function defaultGrading(percentage) {
  const p = Math.max(0, Math.min(Number(percentage || 0), 100));
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

function normalizeScore(rawScore, rawTotalMarks) {
  const score = Number(rawScore);
  const totalMarks = Number(rawTotalMarks);
  if (!Number.isFinite(totalMarks) || totalMarks <= 0 || totalMarks > 100000) {
    throw new Error("Exam total marks must be greater than zero.");
  }
  if (!Number.isFinite(score) || score < 0) throw new Error("Score must be zero or greater.");
  if (score > totalMarks) throw new Error(`Score cannot exceed the exam total marks (${totalMarks}).`);
  const percentage = Math.round((score / totalMarks) * 10000) / 100;
  return { totalMarks, score, percentage };
}

function buildResultScopeFromExam(exam = {}) {
  return {
    classGroup: exam.classGroup || null,
    sectionId: exam.sectionId || null,
    sectionName: str(exam.sectionName, 180),
    sectionCode: str(exam.sectionCode, 80),
    streamId: exam.streamId || null,
    streamName: str(exam.streamName, 180),
    streamCode: str(exam.streamCode, 80),
    subject: exam.subject || null,
    academicYear: str(exam.academicYear, 20),
    term: Math.max(1, Math.min(Number(exam.term || 1), 3)),
    passMark: Math.max(0, Math.min(Number(exam.passMark ?? 50), Number(exam.maxMarks ?? 100))),
  };
}

function assertExamAllowsResultEntry(exam = {}) {
  const status = str(exam.status, 20).toLowerCase();
  if (!RESULT_ENTRY_EXAM_STATUSES.has(status)) {
    throw new Error("Results can only be entered for Scheduled or Completed exams.");
  }
  if (!exam.classGroup || !exam.subject) throw new Error("Exam academic scope is incomplete.");
  return true;
}

function assertExamAllowsPublication(exam = {}) {
  if (str(exam.status, 20).toLowerCase() !== "completed") {
    throw new Error("Results can only be published after the exam is Completed.");
  }
  return true;
}

function assertStudentMatchesExamScope(student = {}, exam = {}) {
  if (!student || student.isDeleted === true || str(student.status, 30).toLowerCase() !== "active") {
    throw new Error("Only active students can receive new results.");
  }

  const studentClass = student.classId || student.classGroup || "";
  if (exam.classGroup && !studentClass) throw new Error("Student has no class assignment for this exam.");
  if (exam.classGroup && !sameId(studentClass, exam.classGroup)) throw new Error("Student is not in the selected exam class.");
  if (exam.sectionId && !sameId(student.sectionId, exam.sectionId)) throw new Error("Student is not in the selected exam section.");
  if (exam.streamId && !sameId(student.streamId, exam.streamId)) throw new Error("Student is not in the selected exam stream.");
  if (exam.academicYear && str(student.academicYear, 20) !== str(exam.academicYear, 20)) throw new Error("Student academic year does not match this exam.");
  if (exam.term && Number(student.term || 0) !== Number(exam.term)) throw new Error("Student term does not match this exam.");
  return true;
}

function targetStudentFilter(exam = {}) {
  const filter = { isDeleted: { $ne: true }, status: "active" };
  if (exam.classGroup) filter.classId = idText(exam.classGroup);
  if (exam.sectionId) filter.sectionId = idText(exam.sectionId);
  if (exam.streamId) filter.streamId = idText(exam.streamId);
  if (exam.academicYear) filter.academicYear = str(exam.academicYear, 20);
  if (exam.term) filter.term = Number(exam.term);
  return filter;
}

function wasEverPublished(result = {}) {
  return !!(result.firstPublishedAt || result.publishedAt || result.publishedBy || result.reopenedAt || result.reopenedBy);
}

function assertResultEditable(result = {}) {
  if (str(result.status, 20).toLowerCase() === "published") {
    throw new Error("Published results are locked. Reopen the result before correcting it.");
  }
  if (result.migrationQuarantinedAt) throw new Error("Quarantined legacy results cannot be edited from the normal Results workflow.");
  return true;
}

function assertIdentityChangeAllowed(result = {}, nextExamId, nextStudentId) {
  if (!wasEverPublished(result)) return true;
  if (!sameId(result.exam, nextExamId) || !sameId(result.student, nextStudentId)) {
    throw new Error("A result that has been published before cannot be reassigned to another exam or student.");
  }
  return true;
}

function assertDeleteAllowed(result = {}) {
  if (str(result.status, 20).toLowerCase() !== "draft") throw new Error("Published results cannot be deleted. Reopen them first if a correction is required.");
  if (wasEverPublished(result)) throw new Error("Previously published results are retained for audit and cannot be permanently deleted.");
  if (result.migrationQuarantinedAt) throw new Error("Quarantined legacy results cannot be deleted from the normal Results workflow.");
  return true;
}

function resultStatusUpdate(result = {}, nextStatus, actorId, exam = {}, now = new Date()) {
  const current = normalizeResultStatus(result.status || "draft");
  const next = normalizeResultStatus(nextStatus);
  if (result.migrationQuarantinedAt) throw new Error("Quarantined legacy results cannot change status from the normal Results workflow.");
  if (current === next) return { status: current };

  if (next === "published") {
    assertExamAllowsPublication(exam);
    return {
      status: "published",
      firstPublishedAt: result.firstPublishedAt || result.publishedAt || now,
      publishedAt: now,
      publishedBy: actorId || null,
      updatedBy: actorId || null,
      reopenedAt: null,
      reopenedBy: null,
      revision: Math.max(0, Number(result.revision || 0)) + (wasEverPublished(result) ? 1 : 0),
    };
  }

  return {
    status: "draft",
    publishedAt: null,
    reopenedAt: now,
    reopenedBy: actorId || null,
    updatedBy: actorId || null,
  };
}

function buildResultValues({ exam, student, score, grade, remark, status = "draft", actorId = null, current = null, now = new Date() }) {
  assertExamAllowsResultEntry(exam);
  assertStudentMatchesExamScope(student, exam);
  if (current) {
    assertResultEditable(current);
    assertIdentityChangeAllowed(current, exam._id || exam.id, student._id || student.id);
  }

  const marks = normalizeScore(score, exam.maxMarks ?? 100);
  const auto = defaultGrading(marks.percentage);
  const nextStatus = normalizeResultStatus(status, "draft");
  const values = {
    exam: exam._id || exam.id,
    student: student._id || student.id,
    ...buildResultScopeFromExam(exam),
    ...marks,
    grade: str(grade, 10) || auto.grade,
    remark: str(remark, 300) || auto.remark,
    status: nextStatus,
    updatedBy: actorId || null,
  };

  if (!current) {
    values.enteredBy = actorId || null;
    values.revision = 0;
  }

  if (nextStatus === "published") {
    assertExamAllowsPublication(exam);
    const statusValues = resultStatusUpdate(current || { status: "draft" }, "published", actorId, exam, now);
    Object.assign(values, statusValues);
  } else if (!current) {
    values.publishedAt = null;
    values.firstPublishedAt = null;
    values.publishedBy = null;
    values.reopenedAt = null;
    values.reopenedBy = null;
  }

  return values;
}

function studentPublishedResultFilter(studentId, extra = {}) {
  return { student: studentId, status: "published", migrationQuarantinedAt: null, ...extra };
}

module.exports = {
  RESULT_STATUSES,
  RESULT_ENTRY_EXAM_STATUSES,
  str,
  idText,
  sameId,
  escapeRegExp,
  csvCell,
  normalizeResultStatus,
  defaultGrading,
  normalizeScore,
  buildResultScopeFromExam,
  assertExamAllowsResultEntry,
  assertExamAllowsPublication,
  assertStudentMatchesExamScope,
  targetStudentFilter,
  wasEverPublished,
  assertResultEditable,
  assertIdentityChangeAllowed,
  assertDeleteAllowed,
  resultStatusUpdate,
  buildResultValues,
  studentPublishedResultFilter,
};
