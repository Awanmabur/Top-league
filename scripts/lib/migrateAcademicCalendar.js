const {
  normalizeEventStatus,
  normalizeTerm,
  normalizeDateKey,
  dateFromKey,
} = require("../../src/services/tenant/academicCalendarService");

const str = (v, max = 500) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => !v ? "" : String(typeof v === "object" && v._id ? v._id : v);

function legacyCalendarStatus(value) {
  const raw = str(value, 30).toLowerCase();
  if (["published", "publish", "live", "active"].includes(raw)) return "active";
  if (["archived", "archive", "deleted"].includes(raw)) return "archived";
  if (["inactive", "unpublished", "draft", ""].includes(raw)) return "draft";
  try { return normalizeEventStatus(raw, "draft"); } catch { return null; }
}

function dateKeyFromLegacy(value) {
  if (!value) return "";
  try {
    if (value instanceof Date) return normalizeDateKey(value, "Date");
    const raw = str(value, 40);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return normalizeDateKey(raw, "Date");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return normalizeDateKey(parsed, "Date");
  } catch { return ""; }
}

async function migrateAcademicCalendar(models = {}) {
  const { AcademicEvent, Class, Section, Stream } = models;
  if (!AcademicEvent || !Class || !Section || !Stream) {
    return { skipped: true, reason: "AcademicEvent, Class, Section and Stream models are required" };
  }
  const [rows, classes, sections, streams] = await Promise.all([
    AcademicEvent.collection.find({}).toArray(),
    Class.collection.find({}).toArray(),
    Section.collection.find({}).toArray(),
    Stream.collection.find({}).toArray(),
  ]);
  const byClassId = new Map(classes.map((x) => [idText(x._id), x]));
  const byClassName = new Map(classes.map((x) => [str(x.name || x.className, 180).toLowerCase(), x]).filter(([k]) => k));
  const byClassCode = new Map(classes.map((x) => [str(x.code || x.classCode, 40).toUpperCase(), x]).filter(([k]) => k));
  const bySectionId = new Map(sections.map((x) => [idText(x._id), x]));
  const bySectionCode = new Map(sections.map((x) => [str(x.code, 40).toUpperCase(), x]).filter(([k]) => k));
  const bySectionName = new Map(sections.map((x) => [str(x.name, 100).toLowerCase(), x]).filter(([k]) => k));
  const byStreamId = new Map(streams.map((x) => [idText(x._id), x]));
  const byStreamCode = new Map(streams.map((x) => [str(x.code, 40).toUpperCase(), x]).filter(([k]) => k));
  const byStreamName = new Map(streams.map((x) => [str(x.name, 100).toLowerCase(), x]).filter(([k]) => k));
  let scanned = 0, normalized = 0, quarantined = 0;
  for (const row of rows) {
    scanned += 1;
    const reasons = [];
    let status = legacyCalendarStatus(row.status || row.state || (row.isPublished ? "active" : "draft"));
    if (!status) { status = "draft"; reasons.push("Calendar status is invalid."); }
    const startKey = dateKeyFromLegacy(row.startDateKey || row.startDate || row.date || row.eventDate);
    const endKey = dateKeyFromLegacy(row.endDateKey || row.endDate || row.startDate || row.date || row.eventDate) || startKey;
    if (!startKey) reasons.push("Calendar start date is invalid.");
    if (startKey && endKey && endKey < startKey) reasons.push("Calendar end date is before start date.");

    const classRef = idText(row.classGroup || row.classId);
    const sectionRef = idText(row.sectionId);
    const streamRef = idText(row.streamId);
    const classNameHint = str(row.className, 180);
    const classCodeHint = str(row.classCode, 40);
    const sectionNameHint = str(row.sectionName, 100);
    const sectionCodeHint = str(row.sectionCode, 40);
    const streamNameHint = str(row.streamName, 100);
    const streamCodeHint = str(row.streamCode, 40);
    const hasClassHint = !!(classRef || classNameHint || classCodeHint);
    const hasSectionHint = !!(sectionRef || sectionNameHint || sectionCodeHint);
    const hasStreamHint = !!(streamRef || streamNameHint || streamCodeHint);
    const classDoc = hasClassHint ? (byClassId.get(classRef) || byClassCode.get(classCodeHint.toUpperCase()) || byClassName.get(classNameHint.toLowerCase()) || null) : null;
    const section = hasSectionHint ? (bySectionId.get(sectionRef) || bySectionCode.get(sectionCodeHint.toUpperCase()) || bySectionName.get(sectionNameHint.toLowerCase()) || null) : null;
    const stream = hasStreamHint ? (byStreamId.get(streamRef) || byStreamCode.get(streamCodeHint.toUpperCase()) || byStreamName.get(streamNameHint.toLowerCase()) || null) : null;
    if (hasClassHint && !classDoc) reasons.push("Calendar class scope could not be resolved safely.");
    if (hasSectionHint && !section) reasons.push("Calendar section scope could not be resolved safely.");
    if (hasStreamHint && !stream) reasons.push("Calendar stream scope could not be resolved safely.");
    if (section && classDoc && idText(section.classId) && idText(section.classId) !== idText(classDoc._id)) reasons.push("Calendar section/class scope conflicts.");
    if (stream && classDoc && idText(stream.classId) && idText(stream.classId) !== idText(classDoc._id)) reasons.push("Calendar stream/class scope conflicts.");
    if (stream && section && idText(stream.sectionId) && idText(stream.sectionId) !== idText(section._id)) reasons.push("Calendar stream/section scope conflicts.");
    if (status === "active" && classDoc && str(classDoc.status, 20).toLowerCase() !== "active") reasons.push("Published calendar class is not active.");
    if (status === "active" && section && str(section.status, 20).toLowerCase() !== "active") reasons.push("Published calendar section is not active.");
    if (status === "active" && stream && str(stream.status, 20).toLowerCase() !== "active") reasons.push("Published calendar stream is not active.");

    const quarantineAt = reasons.length ? (row.migrationQuarantinedAt || new Date()) : null;
    if (reasons.length) { quarantined += 1; if (status === "active") status = "draft"; }
    const nowish = row.updatedAt || row.createdAt || new Date();
    const set = {
      title: str(row.title || row.name || row.eventName, 160) || "Legacy calendar event",
      type: str(row.type || row.category || "School Event", 40) || "School Event",
      academicYear: str(row.academicYear || row.year, 20),
      term: normalizeTerm(row.term || row.semester),
      classGroup: classDoc?._id || null,
      className: str(row.className || classDoc?.name, 180),
      sectionId: section?._id || null,
      sectionName: str(row.sectionName || section?.name, 100),
      sectionCode: str(row.sectionCode || section?.code, 40),
      streamId: stream?._id || null,
      streamName: str(row.streamName || stream?.name, 100),
      streamCode: str(row.streamCode || stream?.code, 40),
      startDateKey: startKey,
      endDateKey: endKey,
      startDate: startKey ? dateFromKey(startKey) : (row.startDate || row.createdAt || new Date(0)),
      endDate: endKey ? dateFromKey(endKey) : null,
      location: str(row.location || row.venue, 120),
      notes: str(row.notes || row.description, 1200),
      status,
      firstPublishedAt: row.firstPublishedAt || (status === "active" ? (row.publishedAt || nowish) : null),
      publishedAt: row.publishedAt || (status === "active" ? nowish : null),
      archivedAt: row.archivedAt || (status === "archived" ? nowish : null),
      revision: Math.max(0, Number(row.revision || 0)),
      isDeleted: row.isDeleted === true,
      migrationQuarantinedAt: quarantineAt,
      migrationQuarantineReason: reasons.join(" ").slice(0, 500),
    };
    await AcademicEvent.collection.updateOne({ _id: row._id }, { $set: set });
    normalized += 1;
  }
  return { scanned, normalized, quarantined };
}

module.exports = { legacyCalendarStatus, dateKeyFromLegacy, migrateAcademicCalendar };
