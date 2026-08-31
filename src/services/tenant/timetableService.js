const crypto = require("crypto");
const DAYS = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const STATUSES = Object.freeze(["active", "inactive", "archived"]);
const WEEK_PATTERNS = Object.freeze(["all", "odd", "even"]);
const SCHEDULE_FIELDS = Object.freeze([
  "academicYear", "term", "classGroup", "sectionId", "streamId", "subject", "teacher",
  "room", "campus", "dayOfWeek", "startTime", "endTime", "weekPattern",
]);

const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const idText = (v) => String(v?._id || v || "");
const sameId = (a, b) => idText(a) === idText(b);
const isObjId = (v) => /^[a-f\d]{24}$/i.test(idText(v));

function csvCell(value) {
  let s = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toMinutes(value) {
  const m = str(value, 8).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function normalizeStatus(value, fallback = "inactive") {
  const v = str(value, 20).toLowerCase();
  const aliases = { published: "active", live: "active", open: "active", draft: "inactive", unpublished: "inactive", closed: "inactive", retired: "archived", deleted: "archived" };
  const out = aliases[v] || v || fallback;
  if (!STATUSES.includes(out)) throw new Error("Invalid timetable status.");
  return out;
}

function normalizeWeekPattern(value) {
  const v = str(value, 20).toLowerCase() || "all";
  if (!WEEK_PATTERNS.includes(v)) throw new Error("Invalid week pattern.");
  return v;
}

function normalizeRoom(value) { return str(value, 80).replace(/\s+/g, " "); }
function roomKey(value) { return normalizeRoom(value).toLowerCase(); }
function overlaps(aStart, aEnd, bStart, bEnd) { return Number(aStart) < Number(bEnd) && Number(aEnd) > Number(bStart); }
function weekPatternsOverlap(a, b) {
  const x = normalizeWeekPattern(a), y = normalizeWeekPattern(b);
  return x === "all" || y === "all" || x === y;
}

function academicScopesOverlap(a, b) {
  if (!sameId(a.classGroup, b.classGroup)) return false;
  const aSection = idText(a.sectionId), bSection = idText(b.sectionId);
  const aStream = idText(a.streamId), bStream = idText(b.streamId);
  if (aSection && bSection && aSection !== bSection) return false;
  if (aStream && bStream && aStream !== bStream) return false;
  return true;
}

function assertTransition(currentStatus, nextStatus) {
  const from = normalizeStatus(currentStatus, "inactive");
  const to = normalizeStatus(nextStatus, from);
  if (from === "archived" && to !== "archived") throw new Error("Archived timetable entries are immutable.");
  return to;
}

function changedFields(current, next, fields = SCHEDULE_FIELDS) {
  return fields.filter((key) => {
    const a = current?.[key], b = next?.[key];
    if (["classGroup", "sectionId", "streamId", "subject", "teacher"].includes(key)) return !sameId(a, b);
    return String(a ?? "") !== String(b ?? "");
  });
}

function assertSubjectMatchesScope(subject, scope) {
  if (!subject) throw new Error("Subject was not found.");
  if (String(subject.status || "") !== "active") throw new Error("Only active subjects can be scheduled.");
  if (subject.classId && !sameId(subject.classId, scope.classGroup)) throw new Error("Subject does not belong to the selected class.");
  if (subject.sectionId && !sameId(subject.sectionId, scope.sectionId)) throw new Error("Subject does not belong to the selected section.");
  if (subject.streamId && !sameId(subject.streamId, scope.streamId)) throw new Error("Subject does not belong to the selected stream.");
  if (subject.academicYear && scope.academicYear && String(subject.academicYear) !== String(scope.academicYear)) throw new Error("Subject academic year does not match the class.");
  if (subject.term && scope.term && Number(subject.term) !== Number(scope.term)) throw new Error("Subject term does not match the class.");
  return true;
}

function assertTeacherSchedulable(staff) {
  if (!staff) return true;
  if (staff.isDeleted === true || String(staff.status || "") !== "Active") throw new Error("Only active staff can be assigned to timetable entries.");
  return true;
}

function buildEntryValues({ source = {}, scope, subject, teacher = null, current = null, actorId = null, now = new Date() }) {
  if (!scope?.classGroup) throw new Error("Class is required.");
  assertSubjectMatchesScope(subject, scope);
  assertTeacherSchedulable(teacher);
  const startTime = str(source.startTime, 8), endTime = str(source.endTime, 8);
  const startMinutes = toMinutes(startTime), endMinutes = toMinutes(endTime);
  if (startMinutes == null || endMinutes == null) throw new Error("Start and end time must use HH:MM format.");
  if (endMinutes <= startMinutes) throw new Error("End time must be after start time.");
  const dayOfWeek = str(source.dayOfWeek, 3);
  if (!DAYS.includes(dayOfWeek)) throw new Error("Invalid timetable day.");
  const nextStatus = current ? assertTransition(current.status, source.status || current.status) : normalizeStatus(source.status, "inactive");
  const room = normalizeRoom(source.room);
  const values = {
    academicYear: str(scope.academicYear || source.academicYear, 20),
    term: Number(scope.term || source.term || 1),
    classGroup: scope.classGroup,
    sectionId: scope.sectionId || null,
    sectionName: str(scope.sectionName, 100),
    sectionCode: str(scope.sectionCode, 40),
    streamId: scope.streamId || null,
    streamName: str(scope.streamName, 100),
    streamCode: str(scope.streamCode, 40),
    subject: subject._id || subject,
    teacher: teacher?._id || teacher || null,
    room,
    roomKey: roomKey(room),
    campus: str(source.campus || scope.campusName, 80),
    dayOfWeek,
    startTime,
    endTime,
    startMinutes,
    endMinutes,
    weekPattern: normalizeWeekPattern(source.weekPattern),
    status: nextStatus,
    note: str(source.note, 500),
    revision: Number(current?.revision || 0) + 1,
    updatedBy: actorId || null,
    migrationQuarantinedAt: null,
    migrationQuarantineReason: "",
  };
  if (!current) values.createdBy = actorId || null;
  if (nextStatus === "active" && !current?.publishedAt) values.publishedAt = now;
  else if (current?.publishedAt) values.publishedAt = current.publishedAt;
  if (nextStatus === "archived") values.archivedAt = current?.archivedAt || now;
  else if (current?.archivedAt) values.archivedAt = current.archivedAt;
  return values;
}


function buildStatusValues(current, nextStatus, actorId = null, now = new Date()) {
  if (!current) throw new Error("Timetable entry is required.");
  const status = assertTransition(current.status, nextStatus);
  const values = {
    status,
    revision: Number(current.revision || 0) + 1,
    updatedBy: actorId || null,
  };
  if (status === "archived") values.archivedAt = current.archivedAt || now;
  return values;
}

function scheduleLockKey(entry) {
  const academicYear = str(entry?.academicYear, 20) || "_";
  const term = [1, 2, 3].includes(Number(entry?.term)) ? Number(entry.term) : 1;
  const day = str(entry?.dayOfWeek, 3);
  if (!DAYS.includes(day)) throw new Error("Invalid timetable day for schedule lock.");
  return `${academicYear}|${term}|${day}`;
}

function scheduleLockKeys(entries) {
  return [...new Set((entries || []).filter(Boolean).map(scheduleLockKey))].sort();
}

async function acquireScheduleLocks(TimetableMutationLock, entries, { now = new Date(), ttlMs = 300000 } = {}) {
  if (!TimetableMutationLock) throw new Error("Timetable mutation lock model is required.");
  const keys = scheduleLockKeys(entries);
  if (!keys.length) return { token: "", keys: [], leaseUntil: null };
  const token = crypto.randomBytes(18).toString("hex");
  const leaseUntil = new Date(now.getTime() + Math.max(30000, Number(ttlMs) || 300000));
  const acquired = [];
  try {
    for (const key of keys) {
      let doc;
      try {
        doc = await TimetableMutationLock.findOneAndUpdate(
          { key, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
          { $set: { token, leaseUntil }, $setOnInsert: { key } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (err) {
        if (err?.code === 11000) throw new Error("Timetable schedule is busy. Retry the change.");
        throw err;
      }
      if (!doc || String(doc.token || "") !== token) throw new Error("Timetable schedule is busy. Retry the change.");
      acquired.push(key);
    }
    return { token, keys, leaseUntil };
  } catch (err) {
    if (acquired.length) {
      await TimetableMutationLock.updateMany(
        { key: { $in: acquired }, token },
        { $set: { token: "", leaseUntil: null } }
      ).catch(() => null);
    }
    throw err;
  }
}

async function releaseScheduleLocks(TimetableMutationLock, lease) {
  if (!TimetableMutationLock || !lease?.token || !lease?.keys?.length) return 0;
  const result = await TimetableMutationLock.updateMany(
    { key: { $in: lease.keys }, token: lease.token },
    { $set: { token: "", leaseUntil: null } }
  );
  return result.modifiedCount || 0;
}

async function withScheduleLocks(TimetableMutationLock, entries, fn, options) {
  const lease = await acquireScheduleLocks(TimetableMutationLock, entries, options);
  try {
    return await fn(lease);
  } finally {
    await releaseScheduleLocks(TimetableMutationLock, lease).catch(() => null);
  }
}

function needsConflictCheck(current, next) {
  if (next.status !== "active") return false;
  if (!current || current.status !== "active") return true;
  return changedFields(current, next).length > 0;
}

function conflictKindsBetween(a, b) {
  if (String(a.status || "inactive") !== "active" || String(b.status || "inactive") !== "active") return [];
  if (String(a.academicYear || "") !== String(b.academicYear || "")) return [];
  if (Number(a.term || 1) !== Number(b.term || 1)) return [];
  if (String(a.dayOfWeek || "") !== String(b.dayOfWeek || "")) return [];
  if (!weekPatternsOverlap(a.weekPattern, b.weekPattern)) return [];
  if (!overlaps(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)) return [];
  const kinds = [];
  if (academicScopesOverlap(a, b)) kinds.push("class");
  if (a.teacher && b.teacher && sameId(a.teacher, b.teacher)) kinds.push("teacher");
  if (a.roomKey && b.roomKey && String(a.roomKey) === String(b.roomKey)) kinds.push("room");
  return kinds;
}

async function findConflicts(TimetableEntry, candidate, excludeId = null) {
  if (candidate.status !== "active") return [];
  const query = {
    status: "active",
    migrationQuarantinedAt: null,
    academicYear: candidate.academicYear || "",
    term: Number(candidate.term || 1),
    dayOfWeek: candidate.dayOfWeek,
    startMinutes: { $lt: candidate.endMinutes },
    endMinutes: { $gt: candidate.startMinutes },
  };
  if (excludeId) query._id = { $ne: excludeId };
  const rows = await TimetableEntry.find(query).select("classGroup sectionId streamId teacher room roomKey subject dayOfWeek startTime endTime startMinutes endMinutes weekPattern status academicYear term").lean();
  return rows.flatMap((row) => conflictKindsBetween(candidate, row).map((type) => ({ type, item: row })));
}

function targetStudentFilter(entry) {
  const filter = { isDeleted: { $ne: true }, status: "active", classId: idText(entry.classGroup) };
  if (entry.sectionId) filter.sectionId = idText(entry.sectionId);
  if (entry.streamId) filter.streamId = idText(entry.streamId);
  if (entry.academicYear) filter.academicYear = String(entry.academicYear);
  if (entry.term) filter.term = Number(entry.term);
  return filter;
}

function studentTimetableFilter(student) {
  const classId = idText(student?.classId);
  if (!classId || !isObjId(classId)) return { _id: null };
  const sectionId = idText(student?.sectionId);
  const streamId = idText(student?.streamId);
  const filter = { classGroup: classId, status: "active", migrationQuarantinedAt: null };
  filter.$and = [
    sectionId && isObjId(sectionId) ? { $or: [{ sectionId: null }, { sectionId }] } : { sectionId: null },
    streamId && isObjId(streamId) ? { $or: [{ streamId: null }, { streamId }] } : { streamId: null },
  ];
  if (student.academicYear) filter.academicYear = String(student.academicYear);
  if ([1, 2, 3].includes(Number(student.term))) filter.term = Number(student.term);
  return filter;
}

function timetableMessage(entry, action = "published") {
  const subjectName = entry.subject?.title || entry.subject?.shortTitle || entry.subject?.code || "Class";
  const when = `${entry.dayOfWeek} ${entry.startTime}-${entry.endTime}`;
  const label = action === "updated" ? "Timetable updated" : "Timetable published";
  return { title: label, message: `${subjectName}: ${when}${entry.room ? `, ${entry.room}` : ""}.`, action };
}

async function notifyTargetStudents(models, entry, actorId = null, action = "published") {
  const { Student, Notification } = models || {};
  if (!Student || !Notification || !entry?._id || entry.status !== "active") return 0;
  const students = await Student.find({ ...targetStudentFilter(entry), userId: { $ne: null } }).select("userId").limit(5000).lean();
  const msg = timetableMessage(entry, action);
  if (!students.length) return 0;
  const ops = students.map((s) => ({ updateOne: { filter: { userId: s.userId, entityType: "timetable", entityId: entry._id, entityAction: action }, update: { $set: { audience: "student", title: msg.title, message: msg.message, type: "info", url: "/student/timetable", isDeleted: false, deletedAt: null, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } }, upsert: true } }));
  await Notification.bulkWrite(ops, { ordered: false });
  return ops.length;
}

async function notifyAssignedTeacher(models, entry, actorId = null, action = "published") {
  const { Staff, Notification } = models || {};
  if (!Staff || !Notification || !entry?._id || entry.status !== "active" || !entry.teacher) return 0;
  const staff = await Staff.findOne({ _id: entry.teacher, isDeleted: { $ne: true }, status: "Active", userId: { $ne: null } }).select("userId").lean();
  if (!staff?.userId) return 0;
  const msg = timetableMessage(entry, action);
  await Notification.findOneAndUpdate({ userId: staff.userId, entityType: "timetable", entityId: entry._id, entityAction: action }, { $set: { audience: "staff", title: msg.title, message: msg.message, type: "info", url: "/staff/timetable", isDeleted: false, deletedAt: null, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return 1;
}

async function retireTimetableNotifications(models, entryId, actorId = null) {
  const { Notification } = models || {};
  if (!Notification || !entryId) return 0;
  const out = await Notification.updateMany({ entityType: "timetable", entityId: entryId, isDeleted: { $ne: true } }, { $set: { isDeleted: true, deletedAt: new Date(), updatedBy: actorId } });
  return out.modifiedCount || 0;
}

function localDateParts(date = new Date(), timezone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}
function isoWeekNumber(date = new Date(), timezone = "UTC") {
  const p = localDateParts(date, timezone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
function currentWeekPattern(date = new Date(), timezone = "UTC") { return isoWeekNumber(date, timezone) % 2 ? "odd" : "even"; }
function weekPatternApplies(pattern, parity) { const p = normalizeWeekPattern(pattern); return p === "all" || p === parity; }
function todayDayCode(date = new Date(), timezone = "UTC") {
  const w = localDateParts(date, timezone).weekday;
  const map = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" };
  return map[w] || "Mon";
}

module.exports = {
  DAYS, STATUSES, WEEK_PATTERNS, SCHEDULE_FIELDS,
  str, idText, sameId, csvCell, toMinutes, normalizeStatus, normalizeWeekPattern, normalizeRoom, roomKey,
  overlaps, weekPatternsOverlap, academicScopesOverlap, assertTransition, changedFields,
  assertSubjectMatchesScope, assertTeacherSchedulable, buildEntryValues, buildStatusValues, needsConflictCheck,
  scheduleLockKey, scheduleLockKeys, acquireScheduleLocks, releaseScheduleLocks, withScheduleLocks,
  conflictKindsBetween, findConflicts, targetStudentFilter, studentTimetableFilter,
  timetableMessage, notifyTargetStudents, notifyAssignedTeacher, retireTimetableNotifications,
  localDateParts, isoWeekNumber, currentWeekPattern, weekPatternApplies, todayDayCode,
};
