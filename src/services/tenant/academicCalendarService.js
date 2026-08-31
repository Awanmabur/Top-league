const EVENT_STATUSES = new Set(["draft", "active", "archived"]);
const str = (v, max = 500) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => !v ? "" : String(typeof v === "object" && v._id ? v._id : v);
const sameId = (a, b) => idText(a) === idText(b);
function escapeRegExp(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function csvCell(value) { let text = String(value ?? ""); if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; }
function normalizeEventStatus(value, fallback = "draft") { const s = str(value, 20).toLowerCase(); if (!s) return fallback; if (!EVENT_STATUSES.has(s)) throw new Error("Invalid calendar status."); return s; }
function normalizeTerm(value) { const raw = str(value, 40); if (!raw) return ""; const m = raw.match(/^(?:term|semester)?\s*([1-3])$/i); return m ? `Term ${m[1]}` : raw; }
function normalizeDateKey(value, field = "Date") {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : str(value, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${field} must be YYYY-MM-DD.`);
  const [y,m,d] = raw.split("-").map(Number); const dt = new Date(Date.UTC(y,m-1,d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m-1 || dt.getUTCDate() !== d) throw new Error(`${field} is invalid.`);
  return raw;
}
function dateFromKey(key) { return new Date(`${normalizeDateKey(key)}T00:00:00.000Z`); }
function assertDateRange(startKey, endKey) { const start = normalizeDateKey(startKey, "Start date"); const end = endKey ? normalizeDateKey(endKey, "End date") : start; if (end < start) throw new Error("End date cannot be before start date."); return { start, end }; }
function eventScopeMatchesStudent(event, student) {
  if (event?.classGroup && !sameId(event.classGroup, student?.classId || student?.classGroup)) return false;
  if (event?.sectionId && !sameId(event.sectionId, student?.sectionId)) return false;
  if (event?.streamId && !sameId(event.streamId, student?.streamId)) return false;
  if (event?.academicYear && str(event.academicYear,20) !== str(student?.academicYear,20)) return false;
  if (event?.term && normalizeTerm(event.term) !== normalizeTerm(student?.term)) return false;
  return true;
}
function calendarVisibilityFilterForStudent(student = {}) {
  const classId = idText(student.classId || student.classGroup), sectionId = idText(student.sectionId), streamId = idText(student.streamId);
  const and = [{ status:"active" }, { isDeleted:{ $ne:true } }, { migrationQuarantinedAt:null }];
  if (classId) and.push({ $or:[{classGroup:null},{classGroup:{ $exists:false }},{classGroup:classId}] }); else and.push({ $or:[{classGroup:null},{classGroup:{ $exists:false }}] });
  if (sectionId) and.push({ $or:[{sectionId:null},{sectionId:{ $exists:false }},{sectionId}] }); else and.push({ $or:[{sectionId:null},{sectionId:{ $exists:false }}] });
  if (streamId) and.push({ $or:[{streamId:null},{streamId:{ $exists:false }},{streamId}] }); else and.push({ $or:[{streamId:null},{streamId:{ $exists:false }}] });
  if (student.academicYear) and.push({ $or:[{academicYear:""},{academicYear:{ $exists:false }},{academicYear:str(student.academicYear,20)}] });
  const term = normalizeTerm(student.term); if (term) and.push({ $or:[{term:""},{term:{ $exists:false }},{term}] });
  return { $and: and };
}
function publicCalendarFilter(extra = {}) { return { status:"active", isDeleted:{ $ne:true }, migrationQuarantinedAt:null, ...extra }; }
function assertCalendarLifecycle(current = {}, nextStatus) {
  const from = normalizeEventStatus(current.status || "draft"), to = normalizeEventStatus(nextStatus, from);
  if (from === "archived" && to !== "archived") throw new Error("Archived calendar events are immutable.");
  return to;
}
function assertCalendarDeleteAllowed(current = {}) { if (normalizeEventStatus(current.status || "draft") !== "draft" || current.firstPublishedAt || current.publishedAt) throw new Error("Only never-published draft calendar events can be permanently deleted."); return true; }
function buildCalendarValues({ input = {}, scope = {}, current = null, actorId = null, now = new Date() }) {
  const title = str(input.title,160), type = str(input.type,40); if (title.length < 2) throw new Error("Calendar title is required."); if (type.length < 2) throw new Error("Calendar type is required.");
  const range = assertDateRange(input.startDateKey || input.startDate, input.endDateKey || input.endDate || input.startDateKey || input.startDate);
  const status = current ? assertCalendarLifecycle(current, input.status || current.status) : normalizeEventStatus(input.status || "draft");
  const values = {
    title, type, academicYear:str(input.academicYear,20), term:normalizeTerm(input.term),
    classGroup:scope.classGroup || scope.classId || null, className:str(scope.className,180),
    sectionId:scope.sectionId || null, sectionName:str(scope.sectionName,100), sectionCode:str(scope.sectionCode,40),
    streamId:scope.streamId || null, streamName:str(scope.streamName,100), streamCode:str(scope.streamCode,40),
    startDateKey:range.start, endDateKey:range.end, startDate:dateFromKey(range.start), endDate:dateFromKey(range.end),
    location:str(input.location,120), notes:str(input.notes,1200), status, updatedBy:actorId || null,
    revision: current ? Math.max(0,Number(current.revision||0))+1 : 0,
  };
  if (!current) values.createdBy = actorId || null;
  if (status === "active" && (!current || current.status !== "active")) { values.publishedAt=now; values.publishedBy=actorId||null; values.firstPublishedAt=current?.firstPublishedAt || now; }
  if (status === "archived" && (!current || current.status !== "archived")) { values.archivedAt=now; values.archivedBy=actorId||null; }
  return values;
}
async function targetStudentsForCalendar(models, event) {
  const { Student } = models || {}; if (!Student || !event) return [];
  const filter = { isDeleted:{ $ne:true }, status:{ $in:["active","on_hold","suspended"] } };
  if (event.classGroup) filter.classId=idText(event.classGroup); if (event.sectionId) filter.sectionId=idText(event.sectionId); if (event.streamId) filter.streamId=idText(event.streamId);
  if (event.academicYear) filter.academicYear=str(event.academicYear,20); const m=normalizeTerm(event.term).match(/(\d)$/); if (m) filter.term=Number(m[1]);
  return Student.find(filter).select("_id userId guardianUserId").lean();
}
async function retireCalendarNotifications(models, eventId, actorId = null) { const { Notification }=models||{}; if(!Notification||!eventId)return 0; const r=await Notification.updateMany({entityType:"academic_calendar",entityId:eventId,isDeleted:{ $ne:true }},{ $set:{isDeleted:true,deletedAt:new Date(),updatedBy:actorId||null} }); return r.modifiedCount||0; }
async function syncCalendarNotifications(models, event, actorId = null) {
  const { Notification }=models||{}; if(!Notification||!event?._id)return 0; await retireCalendarNotifications(models,event._id,actorId); if(event.status!=="active")return 0;
  const students=await targetStudentsForCalendar(models,event); const users=new Map(); for(const s of students){ if(s.userId)users.set(`student:${s.userId}`,{audience:"student",userId:s.userId,url:"/student/calendar"}); if(s.guardianUserId)users.set(`parent:${s.guardianUserId}`,{audience:"parent",userId:s.guardianUserId,url:"/parent/calendar"}); }
  users.set("staff:all",{audience:"staff",userId:null,url:"/staff/calendar"}); let count=0;
  for(const target of users.values()){ await Notification.findOneAndUpdate({entityType:"academic_calendar",entityId:event._id,entityAction:"published",audience:target.audience,userId:target.userId,isDeleted:{ $ne:true }},{ $set:{title:`Calendar: ${event.title}`,message:`${event.title} — ${event.startDateKey}${event.endDateKey&&event.endDateKey!==event.startDateKey?` to ${event.endDateKey}`:""}`,type:"info",url:target.url,updatedBy:actorId||null},$setOnInsert:{createdBy:actorId||null,isRead:false,isDeleted:false}},{upsert:true,new:true,setDefaultsOnInsert:true}); count++; }
  return count;
}
module.exports={ normalizeEventStatus,normalizeTerm,normalizeDateKey,dateFromKey,assertDateRange,eventScopeMatchesStudent,calendarVisibilityFilterForStudent,publicCalendarFilter,assertCalendarLifecycle,assertCalendarDeleteAllowed,buildCalendarValues,targetStudentsForCalendar,retireCalendarNotifications,syncCalendarNotifications,escapeRegExp,csvCell };
