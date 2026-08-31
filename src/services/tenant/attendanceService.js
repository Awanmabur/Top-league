const ATTENDANCE_STATUSES = new Set(["present", "absent", "late", "excused"]);
const ATTENDED_STATUSES = new Set(["present", "late", "excused"]);

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

function normalizeAttendanceStatus(value, fallback = "present") {
  const raw = str(value, 30).toLowerCase();
  if (!raw) return fallback;
  const aliases = {
    p: "present", attended: "present", here: "present",
    a: "absent", missed: "absent", missing: "absent",
    l: "late", tardy: "late",
    e: "excused", excuse: "excused", authorised: "excused", authorized: "excused",
  };
  const status = aliases[raw] || raw;
  if (!ATTENDANCE_STATUSES.has(status)) throw new Error("Invalid attendance status.");
  return status;
}

function isAttendedStatus(status) {
  return ATTENDED_STATUSES.has(normalizeAttendanceStatus(status));
}

function attendanceSummary(rows = []) {
  const out = { total: 0, present: 0, absent: 0, late: 0, excused: 0, attended: 0, rate: 0 };
  for (const row of rows) {
    if (row?.isDeleted === true || row?.migrationQuarantinedAt) continue;
    const status = normalizeAttendanceStatus(row?.status || "present");
    out.total += 1;
    out[status] += 1;
    if (ATTENDED_STATUSES.has(status)) out.attended += 1;
  }
  out.rate = out.total ? Math.round((out.attended / out.total) * 100) : 0;
  return out;
}

function parseTenantDateTime(value, timezone = "UTC") {
  const raw = str(value, 50);
  if (!raw) throw new Error("Session date/time is required.");
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) {
    const direct = new Date(raw);
    if (Number.isNaN(direct.getTime())) throw new Error("Invalid session date/time.");
    return direct;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error("Invalid session date/time.");
  const [, y, mo, d, h, mi, sec = "0"] = match;
  const targetUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  let guess = targetUtc;
  for (let i = 0; i < 3; i += 1) {
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
  if (Number.isNaN(result.getTime())) throw new Error("Invalid session date/time.");
  return result;
}

function dateKeyInTimezone(date, timezone = "UTC") {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid attendance date.");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    throw new Error("Tenant timezone is invalid.");
  }
}

function attendanceDateFromSession(date, timezone = "UTC") {
  return new Date(`${dateKeyInTimezone(date, timezone)}T00:00:00.000Z`);
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

function attendanceStudentFilter(scope = {}) {
  const filter = { isDeleted: { $ne: true }, status: "active" };
  if (scope.classGroup) filter.classId = idText(scope.classGroup);
  if (scope.sectionId) filter.sectionId = idText(scope.sectionId);
  if (scope.streamId) filter.streamId = idText(scope.streamId);
  if (scope.academicYear) filter.academicYear = str(scope.academicYear, 20);
  if (scope.term) filter.term = Number(scope.term);
  return filter;
}

function assertStudentMatchesAttendanceScope(student = {}, scope = {}) {
  if (!student || student.isDeleted === true || str(student.status, 30).toLowerCase() !== "active") {
    throw new Error("Only active students can receive new attendance records.");
  }
  if (!scope.classGroup) throw new Error("Attendance class scope is required.");
  if (!sameId(student.classId || student.classGroup, scope.classGroup)) throw new Error("Student is not in the selected class.");
  if (scope.sectionId && !sameId(student.sectionId, scope.sectionId)) throw new Error("Student is not in the selected section.");
  if (scope.streamId && !sameId(student.streamId, scope.streamId)) throw new Error("Student is not in the selected stream.");
  if (scope.academicYear && str(student.academicYear, 20) !== str(scope.academicYear, 20)) throw new Error("Student academic year does not match this attendance session.");
  if (scope.term && Number(student.term || 0) !== Number(scope.term)) throw new Error("Student term does not match this attendance session.");
  return true;
}

function assertSubjectMatchesAttendanceScope(subject = {}, scope = {}) {
  if (!subject || str(subject.status, 20).toLowerCase() !== "active") throw new Error("Only an active subject can be used for attendance.");
  if (!scope.classGroup) throw new Error("Attendance class is required.");
  if (subject.classId && !sameId(subject.classId, scope.classGroup)) throw new Error("Selected subject does not belong to the selected class.");
  if (subject.sectionId && !scope.sectionId) throw new Error("This subject is section-specific; select its section.");
  if (subject.streamId && !scope.streamId) throw new Error("This subject is stream-specific; select its stream.");
  if (subject.sectionId && scope.sectionId && !sameId(subject.sectionId, scope.sectionId)) throw new Error("Selected subject does not belong to the selected section.");
  if (subject.streamId && scope.streamId && !sameId(subject.streamId, scope.streamId)) throw new Error("Selected subject does not belong to the selected stream.");
  if (subject.academicYear && scope.academicYear && str(subject.academicYear, 20) !== str(scope.academicYear, 20)) throw new Error("Subject and class academic years do not match.");
  if (subject.term && scope.term && Number(subject.term) !== Number(scope.term)) throw new Error("Subject and class terms do not match.");
  return true;
}

function buildAttendanceValues({ student, subject, scope = {}, sessionAt, status = "present", notes = "", teacher = null, actorId = null, timezone = "UTC", current = null, correctionReason = "", now = new Date() }) {
  assertStudentMatchesAttendanceScope(student, scope);
  assertSubjectMatchesAttendanceScope(subject, scope);
  const parsedSession = sessionAt instanceof Date ? sessionAt : parseTenantDateTime(sessionAt, timezone);
  const nextStatus = normalizeAttendanceStatus(status);
  const values = {
    student: student._id || student.id,
    classGroup: scope.classGroup,
    sectionId: scope.sectionId || null,
    sectionName: str(scope.sectionName, 180),
    sectionCode: str(scope.sectionCode, 80),
    streamId: scope.streamId || null,
    streamName: str(scope.streamName, 180),
    streamCode: str(scope.streamCode, 80),
    subject: subject._id || subject.id,
    teacher: teacher || null,
    academicYear: str(scope.academicYear || subject.academicYear, 20),
    term: Number(scope.term || subject.term || 1),
    attendanceDate: attendanceDateFromSession(parsedSession, timezone),
    sessionAt: parsedSession,
    status: nextStatus,
    notes: str(notes, 500),
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deletionReason: "",
    updatedBy: actorId || null,
  };
  if (!current) {
    values.createdBy = actorId || null;
    values.firstRecordedAt = now;
    values.revision = 0;
  }
  if (current) {
    values.correctedAt = now;
    values.correctedBy = actorId || null;
    values.lastCorrectionReason = str(correctionReason, 500) || "Administrative attendance correction";
    values.revision = Math.max(0, Number(current.revision || 0)) + 1;
  }
  return values;
}

function attendanceCorrectionEntry(current = {}, next = {}, actorId = null, reason = "", now = new Date()) {
  return {
    at: now,
    by: actorId || null,
    reason: str(reason, 500) || "Administrative attendance correction",
    fromStatus: normalizeAttendanceStatus(current.status || "present"),
    toStatus: normalizeAttendanceStatus(next.status || current.status || "present"),
    fromNotes: str(current.notes, 500),
    toNotes: str(next.notes, 500),
    fromSessionAt: current.sessionAt || null,
    toSessionAt: next.sessionAt || current.sessionAt || null,
    fromSubject: current.subject || null,
    toSubject: next.subject || current.subject || null,
  };
}

function softDeleteAttendanceUpdate(current = {}, actorId = null, reason = "", now = new Date()) {
  if (current.isDeleted === true) throw new Error("Attendance record is already archived.");
  if (current.migrationQuarantinedAt) throw new Error("Quarantined legacy attendance cannot be changed from the normal workflow.");
  return {
    isDeleted: true,
    deletedAt: now,
    deletedBy: actorId || null,
    deletionReason: str(reason, 500) || "Administrative attendance archive",
    updatedBy: actorId || null,
    revision: Math.max(0, Number(current.revision || 0)) + 1,
  };
}

function studentAttendanceFilter(studentId, extra = {}) {
  return { student: studentId, isDeleted: { $ne: true }, migrationQuarantinedAt: null, ...extra };
}

module.exports = {
  ATTENDANCE_STATUSES,
  ATTENDED_STATUSES,
  str,
  idText,
  sameId,
  escapeRegExp,
  csvCell,
  normalizeAttendanceStatus,
  isAttendedStatus,
  attendanceSummary,
  parseTenantDateTime,
  dateKeyInTimezone,
  attendanceDateFromSession,
  formatDateTimeLocal,
  formatInTimezone,
  attendanceStudentFilter,
  assertStudentMatchesAttendanceScope,
  assertSubjectMatchesAttendanceScope,
  buildAttendanceValues,
  attendanceCorrectionEntry,
  softDeleteAttendanceUpdate,
  studentAttendanceFilter,
};
