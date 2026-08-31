const ASSIGNMENT_STATUSES = new Set(["draft", "published", "closed", "archived"]);
const SUBMISSION_STATUSES = new Set(["draft", "submitted", "graded"]);
const STRUCTURAL_FIELDS = Object.freeze([
  "course",
  "classGroup",
  "sectionId",
  "streamId",
  "academicYear",
  "term",
  "totalPoints",
]);

const str = (v, max = 500) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
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

function normalizeAssignmentStatus(value, fallback = "draft") {
  const status = str(value, 20).toLowerCase();
  if (!status) return fallback;
  if (!ASSIGNMENT_STATUSES.has(status)) throw new Error("Invalid assignment status.");
  return status;
}

function normalizeSubmissionStatus(value, fallback = "draft") {
  const status = str(value, 20).toLowerCase();
  if (!status) return fallback;
  if (!SUBMISSION_STATUSES.has(status)) throw new Error("Invalid submission status.");
  return status;
}

function safeHttpUrl(value) {
  const raw = str(value, 500);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString().slice(0, 500);
  } catch {
    return "";
  }
}

function normalizeUrlList(values, maxItems = 10) {
  const input = Array.isArray(values) ? values : (values ? [values] : []);
  const output = [];
  for (const value of input) {
    const url = safeHttpUrl(value);
    if (url && !output.includes(url)) output.push(url);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeDueDateInput(value, timezone = "UTC") {
  let raw = str(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw = `${raw}T23:59`;
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) {
    const direct = new Date(raw);
    if (Number.isNaN(direct.getTime())) throw new Error("Invalid due date.");
    return direct;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error("Invalid due date.");
  const [, y, mo, d, h, mi, sec = "0"] = match;
  const targetUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  let guess = targetUtc;
  for (let i = 0; i < 2; i += 1) {
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(guess));
    } catch {
      throw new Error("Tenant timezone is invalid.");
    }
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const renderedAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    guess -= renderedAsUtc - targetUtc;
  }
  const result = new Date(guess);
  if (Number.isNaN(result.getTime())) throw new Error("Invalid due date.");
  return result;
}

function formatInTimezone(date, timezone = "UTC") {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function formatDateTimeLocal(date, timezone = "UTC") {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
  } catch {
    return d.toISOString().slice(0, 16);
  }
}

function assertSubjectMatchesScope(subject = {}, scope = {}) {
  if (!subject || str(subject.status, 20).toLowerCase() !== "active") throw new Error("Only an active subject can be assigned.");
  if (!scope.classId) throw new Error("Assignment class is required.");
  if (!sameId(subject.classId, scope.classId)) throw new Error("Selected subject does not belong to the selected class.");
  if (subject.sectionId && scope.sectionId && !sameId(subject.sectionId, scope.sectionId)) throw new Error("Selected subject does not belong to the selected section.");
  if (subject.streamId && scope.streamId && !sameId(subject.streamId, scope.streamId)) throw new Error("Selected subject does not belong to the selected stream.");
  if (subject.sectionId && !scope.sectionId) throw new Error("This subject is section-specific; select its section.");
  if (subject.streamId && !scope.streamId) throw new Error("This subject is stream-specific; select its stream.");
  if (subject.academicYear && scope.academicYear && str(subject.academicYear, 20) !== str(scope.academicYear, 20)) throw new Error("Subject and class academic years do not match.");
  if (subject.term && scope.term && Number(subject.term) !== Number(scope.term)) throw new Error("Subject and class terms do not match.");
  return true;
}

function assignmentTargetStudentFilter(assignment = {}) {
  const filter = { isDeleted: { $ne: true }, status: "active" };
  if (assignment.classGroup) filter.classId = idText(assignment.classGroup);
  if (assignment.sectionId) filter.sectionId = idText(assignment.sectionId);
  if (assignment.streamId) filter.streamId = idText(assignment.streamId);
  if (assignment.academicYear) filter.academicYear = str(assignment.academicYear, 20);
  if (assignment.term) filter.term = Number(assignment.term);
  return filter;
}

function assertStudentMatchesAssignmentScope(student = {}, assignment = {}) {
  if (!student || student.isDeleted === true || str(student.status, 30).toLowerCase() !== "active") throw new Error("Only active students can submit coursework.");
  if (!assignment.classGroup) throw new Error("Assignment academic scope is incomplete.");
  if (!sameId(student.classId || student.classGroup, assignment.classGroup)) throw new Error("This assignment is not assigned to the student's class.");
  if (assignment.sectionId && !sameId(student.sectionId, assignment.sectionId)) throw new Error("This assignment is not assigned to the student's section.");
  if (assignment.streamId && !sameId(student.streamId, assignment.streamId)) throw new Error("This assignment is not assigned to the student's stream.");
  if (assignment.academicYear && str(student.academicYear, 20) !== str(assignment.academicYear, 20)) throw new Error("This assignment is for a different academic year.");
  if (assignment.term && Number(student.term || 0) !== Number(assignment.term)) throw new Error("This assignment is for a different term.");
  return true;
}

function assignmentVisibilityFilterForStudent(student = {}) {
  const filter = {
    status: { $in: ["published", "closed"] },
    isDeleted: { $ne: true },
    migrationQuarantinedAt: null,
    classGroup: student.classId || student.classGroup || null,
  };
  const and = [];
  if (student.sectionId) and.push({ $or: [{ sectionId: null }, { sectionId: student.sectionId }] });
  else and.push({ sectionId: null });
  if (student.streamId) and.push({ $or: [{ streamId: null }, { streamId: student.streamId }] });
  else and.push({ streamId: null });
  if (student.academicYear) and.push({ $or: [{ academicYear: "" }, { academicYear: str(student.academicYear, 20) }] });
  if (student.term) and.push({ $or: [{ term: null }, { term: Number(student.term) }] });
  if (and.length) filter.$and = and;
  return filter;
}

function structuralChanged(current = {}, next = {}) {
  return STRUCTURAL_FIELDS.some((field) => {
    if (["course", "classGroup", "sectionId", "streamId"].includes(field)) return !sameId(current[field], next[field]);
    return String(current[field] ?? "") !== String(next[field] ?? "");
  });
}

function assertAssignmentEditable(current = {}, next = {}, submissionCount = 0) {
  const status = normalizeAssignmentStatus(current.status || "draft");
  if (current.migrationQuarantinedAt) throw new Error("Quarantined legacy assignments cannot be edited from the normal workflow.");
  if (["closed", "archived"].includes(status)) throw new Error("Closed or archived assignments are locked. Reopen the assignment before editing.");
  if (submissionCount > 0 && structuralChanged(current, next)) throw new Error("Assignment scope, subject, term and total points are locked after the first student submission.");
  return true;
}

function assertAssignmentDeleteAllowed(current = {}, submissionCount = 0) {
  if (current.migrationQuarantinedAt) throw new Error("Quarantined legacy assignments cannot be deleted from the normal workflow.");
  if (normalizeAssignmentStatus(current.status || "draft") !== "draft") throw new Error("Only Draft assignments can be deleted.");
  if (submissionCount > 0) throw new Error("Assignments with student submissions are retained for audit and cannot be deleted.");
  return true;
}

function assignmentStatusUpdate(current = {}, nextStatus, actorId, submissionCount = 0, now = new Date()) {
  const currentStatus = normalizeAssignmentStatus(current.status || "draft");
  const next = normalizeAssignmentStatus(nextStatus);
  if (current.migrationQuarantinedAt) throw new Error("Quarantined legacy assignments cannot change status from the normal workflow.");
  if (currentStatus === next) return { status: currentStatus, updatedBy: actorId || null };
  const allowed = {
    draft: new Set(["published", "archived"]),
    published: new Set(["draft", "closed"]),
    closed: new Set(["published", "archived"]),
    archived: new Set([]),
  };
  if (!allowed[currentStatus]?.has(next)) throw new Error(`Assignment cannot move from ${currentStatus} to ${next}.`);
  if (currentStatus === "published" && next === "draft" && submissionCount > 0) throw new Error("An assignment with student submissions cannot be unpublished. Close it instead.");
  if (next === "published" && !current.classGroup) throw new Error("Assignment class scope is required before publishing.");
  const update = { status: next, updatedBy: actorId || null };
  if (next === "published") {
    update.publishedAt = now;
    update.publishedBy = actorId || null;
    update.closedAt = null;
    update.closedBy = null;
    update.revision = Math.max(0, Number(current.revision || 0)) + (current.publishedAt ? 1 : 0);
  } else if (next === "draft") {
    update.publishedAt = null;
    update.publishedBy = null;
  } else if (next === "closed") {
    update.closedAt = now;
    update.closedBy = actorId || null;
  } else if (next === "archived") {
    update.archivedAt = now;
    update.archivedBy = actorId || null;
  }
  return update;
}

function assertSubmissionAllowed(assignment = {}, student = {}, current = null, now = new Date()) {
  assertStudentMatchesAssignmentScope(student, assignment);
  if (normalizeAssignmentStatus(assignment.status || "draft") !== "published") throw new Error("This assignment is not open for submissions.");
  if (assignment.migrationQuarantinedAt) throw new Error("This assignment is unavailable.");
  if (assignment.dueDate && now.getTime() > new Date(assignment.dueDate).getTime() && !assignment.allowLateSubmissions) throw new Error("The submission deadline has passed.");
  if (current?.migrationQuarantinedAt) throw new Error("This submission is unavailable.");
  if (current && normalizeSubmissionStatus(current.status || "draft") === "graded") throw new Error("Graded submissions are locked. Ask an administrator to reopen the submission.");
  return true;
}

function buildStudentSubmissionValues({ assignment, student, current = null, text = "", attachmentUrls = [], actorId = null, now = new Date() }) {
  assertSubmissionAllowed(assignment, student, current, now);
  const body = str(text, 12000);
  const urls = normalizeUrlList(attachmentUrls, 10);
  if (!body && !urls.length) throw new Error("Add submission text or at least one valid http/https attachment URL.");
  const late = !!(assignment.dueDate && now.getTime() > new Date(assignment.dueDate).getTime());
  return {
    assignment: assignment._id || assignment.id,
    student: student._id || student.id,
    text: body,
    attachmentUrls: urls,
    status: "submitted",
    submittedAt: current?.submittedAt || now,
    lastSubmittedAt: now,
    isLate: late,
    revision: Math.max(0, Number(current?.revision || 0)) + (current?.submittedAt ? 1 : 0),
    submittedBy: actorId || student.userId || null,
    withdrawnAt: null,
    withdrawnBy: null,
  };
}

function withdrawSubmissionUpdate(submission = {}, actorId = null, now = new Date()) {
  const status = normalizeSubmissionStatus(submission.status || "draft");
  if (status !== "submitted") throw new Error("Only a submitted, ungraded submission can be withdrawn.");
  return { status: "draft", withdrawnAt: now, withdrawnBy: actorId || null, updatedBy: actorId || null };
}

function gradeSubmissionUpdate(submission = {}, assignment = {}, score, feedback, actorId = null, now = new Date()) {
  const status = normalizeSubmissionStatus(submission.status || "draft");
  if (status !== "submitted") throw new Error("Only submitted coursework can be graded.");
  const max = Number(assignment.totalPoints ?? 100);
  const parsed = Number(score);
  if (!Number.isFinite(max) || max < 0) throw new Error("Assignment total points are invalid.");
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`Score must be between 0 and ${max}.`);
  return {
    status: "graded",
    score: parsed,
    percentage: max > 0 ? Math.round((parsed / max) * 10000) / 100 : 0,
    feedback: str(feedback, 4000),
    gradedAt: now,
    gradedBy: actorId || null,
    updatedBy: actorId || null,
    gradeRevision: Math.max(0, Number(submission.gradeRevision || 0)) + 1,
  };
}

function reopenSubmissionUpdate(submission = {}, actorId = null, now = new Date()) {
  if (normalizeSubmissionStatus(submission.status || "draft") !== "graded") throw new Error("Only graded coursework can be reopened.");
  return {
    status: "submitted",
    score: null,
    percentage: null,
    feedback: "",
    reopenedAt: now,
    reopenedBy: actorId || null,
    updatedBy: actorId || null,
  };
}

module.exports = {
  ASSIGNMENT_STATUSES,
  SUBMISSION_STATUSES,
  STRUCTURAL_FIELDS,
  str,
  idText,
  sameId,
  escapeRegExp,
  csvCell,
  safeHttpUrl,
  normalizeUrlList,
  normalizeAssignmentStatus,
  normalizeSubmissionStatus,
  normalizeDueDateInput,
  formatInTimezone,
  formatDateTimeLocal,
  assertSubjectMatchesScope,
  assignmentTargetStudentFilter,
  assertStudentMatchesAssignmentScope,
  assignmentVisibilityFilterForStudent,
  structuralChanged,
  assertAssignmentEditable,
  assertAssignmentDeleteAllowed,
  assignmentStatusUpdate,
  assertSubmissionAllowed,
  buildStudentSubmissionValues,
  withdrawSubmissionUpdate,
  gradeSubmissionUpdate,
  reopenSubmissionUpdate,
};
