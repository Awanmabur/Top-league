const VISIBLE_STATUSES = new Set(["scheduled", "completed"]);
const ALL_STATUSES = new Set(["draft", "scheduled", "completed", "archived"]);

const RESULT_LOCKED_FIELDS = Object.freeze([
  "classGroup",
  "sectionId",
  "streamId",
  "subject",
  "academicYear",
  "term",
  "examType",
  "examDate",
  "startTime",
  "endTime",
  "durationMinutes",
  "maxMarks",
  "passMark",
]);

const SCHEDULE_FIELDS = Object.freeze([
  "examDate",
  "startTime",
  "endTime",
  "durationMinutes",
  "room",
  "campus",
]);

function str(value, max = 300) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function idText(value) {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function valueKey(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (value && typeof value === "object" && value._id) return String(value._id);
  if (value === null || value === undefined) return "";
  return String(value);
}

function sameValue(a, b) {
  return valueKey(a) === valueKey(b);
}

function changedFields(before = {}, after = {}, fields = []) {
  return fields.filter((field) => !sameValue(before[field], after[field]));
}

function assertStatusTransition(currentStatus, nextStatus, options = {}) {
  const current = str(currentStatus, 20).toLowerCase();
  const next = str(nextStatus, 20).toLowerCase();
  const hasResults = Number(options.resultCount || 0) > 0;
  const creating = options.creating === true;

  if (!ALL_STATUSES.has(next)) throw new Error("Invalid exam status.");

  if (creating) {
    if (!new Set(["draft", "scheduled"]).has(next)) {
      throw new Error("New exams can only be saved as Draft or Scheduled.");
    }
    return next;
  }

  if (!ALL_STATUSES.has(current)) throw new Error("Current exam status is invalid.");
  if (current === next) return next;

  if (hasResults && new Set(["draft", "scheduled"]).has(next)) {
    throw new Error("An exam with results cannot be moved back to Draft or Scheduled.");
  }

  const allowed = {
    draft: new Set(["scheduled", "archived"]),
    scheduled: new Set(["draft", "completed", "archived"]),
    completed: new Set(["archived"]),
    archived: hasResults ? new Set(["completed"]) : new Set(["draft"]),
  };

  if (!allowed[current]?.has(next)) {
    throw new Error(`Invalid exam status transition: ${current} -> ${next}.`);
  }

  return next;
}

function assertEditAllowed(before = {}, after = {}, options = {}) {
  const resultCount = Number(options.resultCount || 0);
  const locked = changedFields(before, after, RESULT_LOCKED_FIELDS);
  const currentStatus = str(before.status, 20).toLowerCase();

  if (resultCount > 0 && locked.length) {
    throw new Error("Cannot change exam scope, marks, type, or schedule after results exist.");
  }

  if (currentStatus === "completed" && locked.length) {
    throw new Error("Completed exam scope, marks, type, and schedule are locked.");
  }

  return locked;
}

function assertHardDeleteAllowed(exam = {}, resultCount = 0) {
  const status = str(exam.status, 20).toLowerCase();
  if (Number(resultCount || 0) > 0) {
    throw new Error("Cannot delete an exam that already has results. Archive it instead.");
  }
  if (status !== "draft") {
    throw new Error("Only result-free Draft exams can be permanently deleted.");
  }
  return true;
}

async function countExamResults(models = {}, examId) {
  const Result = models.Result;
  if (!Result) throw new Error("Result model is required for exam lifecycle safety.");
  return Result.countDocuments({ exam: examId });
}

async function assertSubjectMatchesScope(models = {}, subjectId, scope = {}, academic = {}) {
  const Subject = models.Subject;
  if (!Subject) throw new Error("Subject model is required.");
  if (!subjectId) throw new Error("Subject is required.");

  const subject = await Subject.findById(subjectId)
    .select("title code status classId sectionId streamId academicYear term")
    .lean();

  if (!subject || subject.status === "archived") throw new Error("Selected subject is not available.");

  const classId = idText(scope.classId || scope.classGroup);
  const sectionId = idText(scope.sectionId);
  const streamId = idText(scope.streamId);

  if (!classId || idText(subject.classId) !== classId) {
    throw new Error("Selected subject does not belong to the selected class.");
  }
  if (idText(subject.sectionId) && idText(subject.sectionId) !== sectionId) {
    throw new Error("Selected subject belongs to a different section.");
  }
  if (idText(subject.streamId) && idText(subject.streamId) !== streamId) {
    throw new Error("Selected subject belongs to a different stream.");
  }

  const academicYear = str(academic.academicYear, 20);
  const term = Number(academic.term || 0);
  if (str(subject.academicYear, 20) && academicYear && str(subject.academicYear, 20) !== academicYear) {
    throw new Error("Selected subject belongs to a different academic year.");
  }
  if (Number(subject.term || 0) && term && Number(subject.term) !== term) {
    throw new Error("Selected subject belongs to a different term.");
  }

  return subject;
}

function publishedScheduleChanged(before = {}, after = {}) {
  if (!VISIBLE_STATUSES.has(str(before.status, 20).toLowerCase())) return false;
  if (!VISIBLE_STATUSES.has(str(after.status, 20).toLowerCase())) return false;
  return changedFields(before, after, SCHEDULE_FIELDS).length > 0;
}

function targetStudentFilter(exam = {}) {
  const classId = idText(exam.classGroup);
  if (!classId) throw new Error("Exam class scope is missing.");

  const filter = {
    isDeleted: { $ne: true },
    status: "active",
    classId,
    userId: { $ne: null },
  };

  const sectionId = idText(exam.sectionId);
  const streamId = idText(exam.streamId);
  if (sectionId) filter.sectionId = sectionId;
  if (streamId) filter.streamId = streamId;
  if (str(exam.academicYear, 20)) filter.academicYear = str(exam.academicYear, 20);
  if (Number(exam.term || 0)) filter.term = Number(exam.term);
  return filter;
}

function examScheduleMessage(exam = {}, changed = false) {
  const when = exam.examDate ? new Date(exam.examDate) : null;
  const date = when && !Number.isNaN(when.getTime()) ? when.toDateString() : "the published date";
  const time = [str(exam.startTime, 5), str(exam.endTime, 5)].filter(Boolean).join(" - ");
  const venue = [str(exam.room, 80), str(exam.campus, 80)].filter(Boolean).join(", ");
  const prefix = changed ? "The schedule for" : "A schedule is now available for";
  return `${prefix} ${str(exam.title || exam.code || "your exam", 180)} on ${date}${time ? ` at ${time}` : ""}${venue ? ` in ${venue}` : ""}.`;
}

async function notifyTargetStudents(models = {}, exam = {}, action = "scheduled", actorId = null) {
  const { Student, Notification } = models;
  if (!Student || !Notification) throw new Error("Student and Notification models are required for exam notifications.");

  const students = await Student.find(targetStudentFilter(exam)).select("userId").lean();
  const recipients = [...new Set(students.map((row) => idText(row.userId)).filter(Boolean))];
  if (!recipients.length) return 0;

  const changed = action === "schedule_changed";
  const title = changed
    ? `Exam schedule updated: ${str(exam.title || exam.code || "Exam", 100)}`
    : `Exam scheduled: ${str(exam.title || exam.code || "Exam", 100)}`;
  const message = examScheduleMessage(exam, changed);
  const entityId = exam._id || exam.id;
  const now = new Date();

  const ops = recipients.map((userId) => ({
    updateOne: {
      filter: { userId, entityType: "Exam", entityId, entityAction: action, isDeleted: { $ne: true } },
      update: {
        $set: {
          audience: "student",
          title,
          message,
          type: "info",
          url: "/student/exams",
          entityType: "Exam",
          entityId,
          entityAction: action,
          isRead: false,
          readAt: null,
          updatedBy: actorId || null,
          updatedAt: now,
        },
        $setOnInsert: { createdBy: actorId || null, createdAt: now },
      },
      upsert: true,
    },
  }));

  await Notification.bulkWrite(ops, { ordered: false });
  return recipients.length;
}

async function retireExamNotifications(models = {}, examId, actorId = null) {
  const { Notification } = models;
  if (!Notification) throw new Error("Notification model is required for exam notification cleanup.");
  const now = new Date();
  const result = await Notification.updateMany(
    { entityType: "Exam", entityId: examId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, deletedAt: now, updatedBy: actorId || null } }
  );
  return Number(result.modifiedCount ?? result.nModified ?? 0);
}

function cloneWith(exam = {}, patch = {}) {
  const plain = typeof exam.toObject === "function" ? exam.toObject() : { ...exam };
  return { ...plain, ...patch };
}

module.exports = {
  ALL_STATUSES,
  VISIBLE_STATUSES,
  RESULT_LOCKED_FIELDS,
  SCHEDULE_FIELDS,
  str,
  idText,
  sameValue,
  changedFields,
  assertStatusTransition,
  assertEditAllowed,
  assertHardDeleteAllowed,
  countExamResults,
  assertSubjectMatchesScope,
  publishedScheduleChanged,
  targetStudentFilter,
  examScheduleMessage,
  notifyTargetStudents,
  retireExamNotifications,
  cloneWith,
};
