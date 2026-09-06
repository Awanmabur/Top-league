const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { loadAcademicScopeLists, resolveAcademicScope, buildAcademicScopeFilter } = require("../../../utils/tenantAcademicScope");
const {
  DAYS, str, csvCell, buildEntryValues, findConflicts, needsConflictCheck,
  notifyTargetStudents, notifyAssignedTeacher, retireTimetableNotifications,
  normalizeStatus, conflictKindsBetween, buildStatusValues, withScheduleLocks,
} = require("../../../services/tenant/timetableService");
const { assertRoomSchedulable } = require("../../../services/tenant/facilityService");

const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const actorId = (req) => req.user?._id || req.user?.userId || null;
const escapeRegExp = (v) => String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function requireModels(req, names) {
  const out = {};
  for (const name of names) {
    if (!req.models?.[name]) throw new Error(`Tenant model ${name} is not loaded.`);
    out[name] = req.models[name];
  }
  return out;
}

async function withTimetableLocks(req, entries, fn) {
  const { TimetableMutationLock } = requireModels(req, ["TimetableMutationLock"]);
  return withScheduleLocks(TimetableMutationLock, entries, fn);
}

function parseCsv(text) {
  const rows = []; let row = []; let cur = ""; let quoted = false;
  const src = String(text || "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i], next = src[i + 1];
    if (ch === '"' && quoted && next === '"') { cur += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === ',') { row.push(cur); cur = ""; continue; }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cur); if (row.some((v) => String(v || "").trim())) rows.push(row); row = []; cur = ""; continue;
    }
    cur += ch;
  }
  row.push(cur); if (row.some((v) => String(v || "").trim())) rows.push(row);
  return rows;
}

const timetableRules = [
  body("classGroup").custom(isObjId).withMessage("Class is required."),
  body("sectionId").optional({ checkFalsy: true }).custom((v) => !v || isObjId(v)).withMessage("Invalid section."),
  body("streamId").optional({ checkFalsy: true }).custom((v) => !v || isObjId(v)).withMessage("Invalid stream."),
  body("subject").custom(isObjId).withMessage("Subject is required."),
  body("teacher").optional({ checkFalsy: true }).custom((v) => !v || isObjId(v)).withMessage("Invalid teacher."),
  body("dayOfWeek").isIn(DAYS).withMessage("Invalid day."),
  body("startTime").matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage("Invalid start time."),
  body("endTime").matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage("Invalid end time."),
  body("weekPattern").optional({ checkFalsy: true }).isIn(["all", "odd", "even"]),
  body("status").optional({ checkFalsy: true }).isIn(["active", "inactive", "archived"]),
  body("room").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("campus").optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body("note").optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
];

async function resolveInput(req, source, current = null) {
  const { Subject, Staff, Class, Section, Stream, Classroom } = requireModels(req, ["Subject", "Staff", "Class", "Section", "Stream", "Classroom"]);
  const resolved = await resolveAcademicScope(req, { classId: source.classGroup, sectionId: source.sectionId, streamId: source.streamId });
  if (resolved.errors.length || !resolved.payload.classId) throw new Error(resolved.errors.join(" ") || "Class scope is required.");
  const classDoc = await Class.findOne({ _id: resolved.payload.classId, status: "active" }).select("_id").lean();
  if (!classDoc) throw new Error("Only an active class can be scheduled.");
  if (resolved.payload.sectionId) { const sectionDoc = await Section.findOne({ _id: resolved.payload.sectionId, status: "active" }).select("_id").lean(); if (!sectionDoc) throw new Error("Only an active section can be scheduled."); }
  if (resolved.payload.streamId) { const streamDoc = await Stream.findOne({ _id: resolved.payload.streamId, status: "active" }).select("_id").lean(); if (!streamDoc) throw new Error("Only an active stream can be scheduled."); }
  const subject = await Subject.findOne({ _id: source.subject, status: "active" }).select("_id code title shortTitle status classId sectionId streamId academicYear term").lean();
  if (!subject) throw new Error("Active subject was not found.");
  let teacher = null;
  if (source.teacher) {
    teacher = await Staff.findOne({ _id: source.teacher, isDeleted: { $ne: true } }).select("_id userId firstName lastName status isDeleted").lean();
    if (!teacher) throw new Error("Teacher was not found.");
  }
  const scope = {
    classGroup: resolved.payload.classId,
    sectionId: resolved.payload.sectionId || null, sectionName: resolved.payload.sectionName || "", sectionCode: resolved.payload.sectionCode || "",
    streamId: resolved.payload.streamId || null, streamName: resolved.payload.streamName || "", streamCode: resolved.payload.streamCode || "",
    academicYear: resolved.payload.academicYear || subject.academicYear || str(source.academicYear, 20),
    term: Number(resolved.payload.term || subject.term || source.term || 1), campusName: resolved.payload.campusName || "",
  };
  const values = buildEntryValues({ source, scope, subject, teacher, current, actorId: actorId(req), now: new Date() });
  if (values.status === "active" && values.roomKey) {
    const classroom = await Classroom.findOne({ roomKey: values.roomKey, migrationQuarantinedAt: null }).select("status name code").lean();
    assertRoomSchedulable(classroom);
  }
  return { values, subject, teacher };
}

async function syncNotifications(req, before, after) {
  if (after.status !== "active") {
    await retireTimetableNotifications(req.models, after._id, actorId(req));
    return;
  }
  if (before) await retireTimetableNotifications(req.models, after._id, actorId(req));
  const action = before && before.status === "active" ? "updated" : "published";
  await Promise.all([
    notifyTargetStudents(req.models, after, actorId(req), action),
    notifyAssignedTeacher(req.models, after, actorId(req), action),
  ]);
}

function queryFilter(req) {
  const q = str(req.query.q, 120), academicYear = str(req.query.academicYear, 20), term = str(req.query.term, 8);
  const classGroup = str(req.query.classGroup, 80), sectionId = str(req.query.sectionId, 80), streamId = str(req.query.streamId, 80);
  const teacher = str(req.query.teacher, 80), dayOfWeek = str(req.query.dayOfWeek, 10), status = str(req.query.status, 20);
  const filter = { migrationQuarantinedAt: null };
  if (academicYear) filter.academicYear = academicYear;
  if ([1,2,3].includes(Number(term))) filter.term = Number(term);
  if (DAYS.includes(dayOfWeek)) filter.dayOfWeek = dayOfWeek;
  Object.assign(filter, buildAcademicScopeFilter({ classGroup, sectionId, streamId }));
  if (isObjId(teacher)) filter.teacher = teacher;
  if (["active","inactive","archived"].includes(status)) filter.status = status;
  if (q) { const rx = escapeRegExp(q); filter.$or = [{ room: { $regex: rx, $options: "i" } }, { campus: { $regex: rx, $options: "i" } }, { note: { $regex: rx, $options: "i" } }]; }
  return { filter, params: { q, academicYear, term, classGroup, sectionId, streamId, teacher, dayOfWeek, status } };
}

function serializeEntry(e) {
  const teacherName = e.teacher?.fullName || [e.teacher?.firstName, e.teacher?.lastName].filter(Boolean).join(" ") || e.teacher?.name || "";
  return {
    id: String(e._id || ""), academicYear: e.academicYear || "", term: Number(e.term || 1),
    classId: String(e.classGroup?._id || e.classGroup || ""), className: e.classGroup?.name || e.classGroup?.code || "",
    sectionId: String(e.sectionId?._id || e.sectionId || ""), sectionName: e.sectionId?.name || e.sectionName || "",
    streamId: String(e.streamId?._id || e.streamId || ""), streamName: e.streamId?.name || e.streamName || "",
    subjectId: String(e.subject?._id || e.subject || ""), subjectCode: e.subject?.code || "", subjectTitle: e.subject?.title || e.subject?.shortTitle || "",
    teacherId: String(e.teacher?._id || e.teacher || ""), teacherName,
    room: e.room || "", campus: e.campus || "", dayOfWeek: e.dayOfWeek || "", startTime: e.startTime || "", endTime: e.endTime || "",
    weekPattern: e.weekPattern || "all", status: e.status || "inactive", note: e.note || "", revision: Number(e.revision || 1),
    publishedAt: e.publishedAt || null,
  };
}

async function mutateStatus(req, current, nextStatus) {
  const { TimetableEntry } = requireModels(req, ["TimetableEntry"]);
  const expected = Number(req.body.revision || current.revision || 1);
  let values;
  if (nextStatus === "active") {
    const source = {
      ...current,
      classGroup: current.classGroup?._id || current.classGroup,
      sectionId: current.sectionId?._id || current.sectionId,
      streamId: current.streamId?._id || current.streamId,
      subject: current.subject?._id || current.subject,
      teacher: current.teacher?._id || current.teacher,
      status: nextStatus,
    };
    values = (await resolveInput(req, source, current)).values;
  } else {
    values = buildStatusValues(current, nextStatus, actorId(req), new Date());
  }

  const lockTargets = [];
  if (current.status === "active") lockTargets.push(current);
  if (values.status === "active") lockTargets.push(values);
  await withTimetableLocks(req, lockTargets, async () => {
    if (needsConflictCheck(current, values)) {
      const conflicts = await findConflicts(TimetableEntry, values, current._id);
      if (conflicts.length) throw new Error(`Cannot publish because of ${[...new Set(conflicts.map((c) => c.type))].join(", ")} conflict(s).`);
    }
    const result = await TimetableEntry.updateOne(
      { _id: current._id, revision: expected, migrationQuarantinedAt: null },
      { $set: values },
      { runValidators: true }
    );
    if (result.modifiedCount !== 1) throw new Error("Timetable entry changed in another session. Reload and try again.");
  });
  const after = { ...current, ...values, _id: current._id };
  await syncNotifications(req, current, after).catch((e) => console.error("TIMETABLE NOTIFICATION ERROR:", e));
  return after;
}


module.exports = {
  timetableRules,
  list: async (req, res) => {
    try {
      const { TimetableEntry, Staff } = requireModels(req, ["TimetableEntry", "Staff"]);
      const { filter, params } = queryFilter(req); const page = Math.max(Number(req.query.page || 1), 1), perPage = 10;
      const kpiFilter = { ...filter }; delete kpiFilter.status;
      const [total, statusRows, staffList, academicYearsRaw, lists] = await Promise.all([
        TimetableEntry.countDocuments(filter), TimetableEntry.aggregate([{ $match:kpiFilter },{ $group:{ _id:"$status",count:{ $sum:1 } } }]),
        Staff.find({ isDeleted: { $ne: true }, status: "Active" }).select("firstName lastName fullName name email jobTitle role").sort({ firstName: 1, lastName: 1 }).limit(1000).lean(),
        TimetableEntry.distinct("academicYear", { migrationQuarantinedAt: null }), loadAcademicScopeLists(req),
      ]);
      const totalPages = Math.max(Math.ceil(total/perPage),1), safePage = Math.min(page,totalPages);
      const entries = await TimetableEntry.find(filter).populate("classGroup","name code classLevel academicYear term").populate("sectionId","name code").populate("streamId","name code").populate("subject","code title shortTitle").populate("teacher","firstName lastName fullName name email").sort({ dayOfWeek:1,startMinutes:1,createdAt:-1 }).skip((safePage-1)*perPage).limit(perPage).lean();
      const statusCounts=Object.fromEntries(statusRows.map((row)=>[String(row._id||""),Number(row.count||0)]));
      return res.render("tenant/timetable/index", { tenant:req.tenant||null, entries, entriesData:entries.map(serializeEntry), classes:lists.classes, sections:lists.sections, streams:lists.streams, subjects:lists.subjects, subjectOptions:lists.subjects, staffList, academicYears:academicYearsRaw.filter(Boolean).sort(), days:DAYS, csrfToken:res.locals.csrfToken||null, kpis:{total,active:statusCounts.active||0,inactive:statusCounts.inactive||0,archived:statusCounts.archived||0}, query:{...params,page:safePage,total,totalPages,perPage}, messages:{success:req.flash?req.flash("success"):[],error:req.flash?req.flash("error"):[]} });
    } catch (err) { console.error("TIMETABLE LIST ERROR:",err); return res.status(500).send("Failed to load timetable."); }
  },

  create: async (req,res) => {
    try {
      const errors=validationResult(req); if(!errors.isEmpty())throw new Error(errors.array().map((e)=>e.msg).join(" "));
      if(req.body.status==="archived")throw new Error("New timetable entries cannot start archived.");
      const { TimetableEntry }=requireModels(req,["TimetableEntry"]); const {values}=await resolveInput(req,req.body,null);
      let created;
      await withTimetableLocks(req, values.status === "active" ? [values] : [], async () => {
        if(values.status==="active"){const conflicts=await findConflicts(TimetableEntry,values);if(conflicts.length)throw new Error(`Schedule conflict: ${[...new Set(conflicts.map((c)=>c.type))].join(", ")}.`);}
        created=await TimetableEntry.create(values);
      });
      const plain=created.toObject?created.toObject():created; await syncNotifications(req,null,plain).catch((e)=>console.error("TIMETABLE NOTIFICATION ERROR:",e)); req.flash?.("success",values.status==="active"?"Timetable entry published.":"Timetable draft created.");
    } catch(err){console.error("CREATE TIMETABLE ERROR:",err);req.flash?.("error",err.message||"Failed to create timetable entry.");}
    return res.redirect("/admin/timetable");
  },

  update: async (req,res) => {
    try {
      const errors=validationResult(req); if(!errors.isEmpty())throw new Error(errors.array().map((e)=>e.msg).join(" "));
      const {TimetableEntry}=requireModels(req,["TimetableEntry"]); if(!isObjId(req.params.id))throw new Error("Invalid timetable entry id.");
      const current=await TimetableEntry.findOne({_id:req.params.id,migrationQuarantinedAt:null}).lean(); if(!current)throw new Error("Timetable entry not found."); if(current.status==="archived")throw new Error("Archived timetable entries are immutable.");
      const {values}=await resolveInput(req,req.body,current); const expected=Number(req.body.revision||current.revision||1);
      const lockTargets=[];if(current.status==="active")lockTargets.push(current);if(values.status==="active")lockTargets.push(values);
      await withTimetableLocks(req,lockTargets,async()=>{
        if(needsConflictCheck(current,values)){const conflicts=await findConflicts(TimetableEntry,values,current._id);if(conflicts.length)throw new Error(`Schedule conflict: ${[...new Set(conflicts.map((c)=>c.type))].join(", ")}.`);}
        const result=await TimetableEntry.updateOne({_id:current._id,revision:expected,migrationQuarantinedAt:null},{$set:values},{runValidators:true}); if(result.modifiedCount!==1)throw new Error("Timetable entry changed in another session. Reload and try again.");
      });
      const after={...current,...values,_id:current._id}; await syncNotifications(req,current,after).catch((e)=>console.error("TIMETABLE NOTIFICATION ERROR:",e)); req.flash?.("success","Timetable entry updated.");
    }catch(err){console.error("UPDATE TIMETABLE ERROR:",err);req.flash?.("error",err.message||"Failed to update timetable entry.");}
    return res.redirect("/admin/timetable");
  },

  setStatus: async(req,res)=>{
    try{const {TimetableEntry}=requireModels(req,["TimetableEntry"]);if(!isObjId(req.params.id))throw new Error("Invalid timetable entry id.");const current=await TimetableEntry.findOne({_id:req.params.id,migrationQuarantinedAt:null}).lean();if(!current)throw new Error("Timetable entry not found.");const next=normalizeStatus(req.body.status,current.status);await mutateStatus(req,current,next);req.flash?.("success",next==="active"?"Timetable entry published.":next==="inactive"?"Timetable entry moved to draft.":"Timetable entry archived.");}catch(err){console.error("TIMETABLE STATUS ERROR:",err);req.flash?.("error",err.message||"Failed to update status.");}return res.redirect("/admin/timetable");
  },

  remove: async(req,res)=>{
    try{const {TimetableEntry}=requireModels(req,["TimetableEntry"]);if(!isObjId(req.params.id))throw new Error("Invalid timetable entry id.");const current=await TimetableEntry.findOne({_id:req.params.id,migrationQuarantinedAt:null}).lean();if(!current)throw new Error("Timetable entry not found.");if(current.status!=="inactive"||current.publishedAt)throw new Error("Only never-published draft timetable entries can be permanently deleted. Archive published history instead.");const result=await TimetableEntry.deleteOne({_id:current._id,status:"inactive",publishedAt:null,revision:Number(req.body.revision||current.revision||1)});if(result.deletedCount!==1)throw new Error("Timetable entry changed in another session. Reload and try again.");await retireTimetableNotifications(req.models,current._id,actorId(req)).catch(()=>null);req.flash?.("success","Draft timetable entry permanently deleted.");}catch(err){console.error("DELETE TIMETABLE ERROR:",err);req.flash?.("error",err.message||"Failed to delete timetable entry.");}return res.redirect("/admin/timetable");
  },

  bulk: async(req,res)=>{
    try{
      const {TimetableEntry}=requireModels(req,["TimetableEntry"]);
      const action=str(req.body.action,20);
      const ids=String(req.body.ids||"").split(",").map((x)=>x.trim()).filter(isObjId);
      if(!ids.length)throw new Error("No timetable entries selected.");
      if(ids.length>500)throw new Error("Select at most 500 entries at a time.");
      const rows=await TimetableEntry.find({_id:{$in:ids},migrationQuarantinedAt:null}).lean();
      if(rows.length!==new Set(ids).size)throw new Error("One or more selected timetable entries no longer exist.");
      const desired=action==="activate"?"active":action==="deactivate"?"inactive":action==="archive"?"archived":null;
      if(action==="delete"){
        for(const row of rows)if(row.status!=="inactive"||row.publishedAt)throw new Error("Bulk delete is limited to never-published drafts.");
      }else if(!desired){
        throw new Error("Invalid bulk action.");
      }

      const plans=[];
      if(action!=="delete"){
        for(const row of rows){
          let values;
          if(desired==="active"){
            const source={...row,classGroup:row.classGroup,sectionId:row.sectionId,streamId:row.streamId,subject:row.subject,teacher:row.teacher,status:desired};
            values=(await resolveInput(req,source,row)).values;
          }else{
            values=buildStatusValues(row,desired,actorId(req),new Date());
          }
          plans.push({row,values});
        }
      }

      const lockTargets=[
        ...rows.filter((row)=>row.status==="active"),
        ...plans.filter((p)=>p.values.status==="active").map((p)=>p.values),
      ];
      await withTimetableLocks(req,lockTargets,async()=>{
        const activeCandidates=plans.filter((p)=>p.values.status==="active");
        const selectedIds=new Set(rows.map((r)=>String(r._id)));
        for(let i=0;i<activeCandidates.length;i+=1){
          const p=activeCandidates[i];
          const dbConflicts=await findConflicts(TimetableEntry,p.values,p.row._id);
          const external=dbConflicts.filter((c)=>!selectedIds.has(String(c.item?._id||"")));
          if(external.length)throw new Error(`Selected entry has ${external[0].type} conflict.`);
          for(let j=0;j<i;j+=1){
            if(conflictKindsBetween(p.values,activeCandidates[j].values).length)throw new Error("Selected entries conflict with each other when published.");
          }
        }

        const applied=[];
        try{
          if(action==="delete"){
            for(const row of rows){
              const r=await TimetableEntry.deleteOne({_id:row._id,status:"inactive",publishedAt:null,revision:Number(row.revision||1)});
              if(r.deletedCount!==1)throw new Error("Concurrent timetable change detected.");
              applied.push({type:"delete",before:row});
            }
          }else{
            for(const p of plans){
              const r=await TimetableEntry.updateOne({_id:p.row._id,revision:Number(p.row.revision||1),migrationQuarantinedAt:null},{$set:p.values},{runValidators:true});
              if(r.modifiedCount!==1)throw new Error("Concurrent timetable change detected.");
              applied.push({type:"update",before:p.row});
            }
          }
        }catch(err){
          for(const item of applied.reverse()){
            try{
              if(item.type==="delete")await TimetableEntry.collection.insertOne(item.before);
              else await TimetableEntry.collection.replaceOne({_id:item.before._id},item.before);
            }catch(rollbackErr){console.error("TIMETABLE BULK ROLLBACK ERROR:",rollbackErr);}
          }
          throw err;
        }
      });

      if(action==="delete"){
        for(const row of rows)await retireTimetableNotifications(req.models,row._id,actorId(req)).catch(()=>null);
      }else{
        for(const p of plans)await syncNotifications(req,p.row,{...p.row,...p.values,_id:p.row._id}).catch(()=>null);
      }
      req.flash?.("success",`Bulk timetable ${action} completed for ${rows.length} item(s).`);
    }catch(err){console.error("TIMETABLE BULK ERROR:",err);req.flash?.("error",err.message||"Bulk action failed.");}
    return res.redirect("/admin/timetable");
  },

  exportCsv: async(req,res)=>{
    try{const {TimetableEntry}=requireModels(req,["TimetableEntry"]);const {filter}=queryFilter(req);const rows=await TimetableEntry.find(filter).populate("classGroup","code name").populate("sectionId","code name").populate("streamId","code name").populate("subject","code title").populate("teacher","email firstName lastName").sort({academicYear:1,term:1,dayOfWeek:1,startMinutes:1}).lean();const header=["classCode","sectionCode","streamCode","subjectCode","dayOfWeek","startTime","endTime","academicYear","term","teacherEmail","room","campus","weekPattern","status","note"];const lines=[header.map(csvCell).join(",")];for(const r of rows)lines.push([r.classGroup?.code||"",r.sectionId?.code||r.sectionCode||"",r.streamId?.code||r.streamCode||"",r.subject?.code||"",r.dayOfWeek,r.startTime,r.endTime,r.academicYear,r.term,r.teacher?.email||"",r.room,r.campus,r.weekPattern,r.status,r.note].map(csvCell).join(","));res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="timetable.csv"');return res.send(lines.join("\n"));}catch(err){console.error("TIMETABLE EXPORT ERROR:",err);return res.status(500).send("Export failed.");}
  },

  importCsv: async(req,res)=>{
    try{
      const {TimetableEntry,Class,Section,Stream,Subject,Staff}=requireModels(req,["TimetableEntry","Class","Section","Stream","Subject","Staff"]);if(!req.file?.buffer)throw new Error("CSV file is required.");const rows=parseCsv(String(req.file.buffer.toString("utf8")||"").replace(/^\uFEFF/,""));if(rows.length<2)throw new Error("CSV file has no data rows.");if(rows.length>3001)throw new Error("CSV import is limited to 3000 rows.");const headers=rows[0].map((h)=>str(h,80));const idx=(name)=>headers.findIndex((h)=>h.toLowerCase()===name.toLowerCase());const required=["classCode","subjectCode","dayOfWeek","startTime","endTime"];for(const h of required)if(idx(h)<0)throw new Error(`CSV must include ${h}.`);
      const [classes,sections,streams,subjects,staff]=await Promise.all([Class.find({status:"active"}).select("_id code").lean(),Section.find({status:"active"}).select("_id code classId").lean(),Stream.find({status:"active"}).select("_id code classId sectionId").lean(),Subject.find({status:"active"}).select("_id code status classId sectionId streamId academicYear term title shortTitle").lean(),Staff.find({isDeleted:{$ne:true},status:"Active"}).select("_id email status isDeleted").lean()]);
      const maps={class:new Map(classes.map((x)=>[str(x.code,40).toUpperCase(),x])),section:new Map(sections.map((x)=>[str(x.code,40).toUpperCase(),x])),stream:new Map(streams.map((x)=>[str(x.code,40).toUpperCase(),x])),subject:new Map(subjects.map((x)=>[str(x.code,40).toUpperCase(),x])),staff:new Map(staff.filter((x)=>x.email).map((x)=>[str(x.email,120).toLowerCase(),x]))};
      const prepared=[],errors=[];
      for(let n=1;n<rows.length;n+=1){const row=rows[n],line=n+1;try{const classDoc=maps.class.get(str(row[idx("classCode")],40).toUpperCase());const subject=maps.subject.get(str(row[idx("subjectCode")],40).toUpperCase());if(!classDoc)throw new Error("unknown classCode");if(!subject)throw new Error("unknown active subjectCode");const sectionCode=idx("sectionCode")>=0?str(row[idx("sectionCode")],40).toUpperCase():"";const streamCode=idx("streamCode")>=0?str(row[idx("streamCode")],40).toUpperCase():"";const section=sectionCode?maps.section.get(sectionCode):null;const stream=streamCode?maps.stream.get(streamCode):null;if(sectionCode&&!section)throw new Error("unknown sectionCode");if(streamCode&&!stream)throw new Error("unknown streamCode");const teacherEmail=idx("teacherEmail")>=0?str(row[idx("teacherEmail")],120).toLowerCase():"";const teacher=teacherEmail?maps.staff.get(teacherEmail):null;if(teacherEmail&&!teacher)throw new Error("unknown active teacherEmail");const source={classGroup:classDoc._id,sectionId:section?._id||"",streamId:stream?._id||"",subject:subject._id,teacher:teacher?._id||"",dayOfWeek:str(row[idx("dayOfWeek")],3),startTime:str(row[idx("startTime")],8),endTime:str(row[idx("endTime")],8),academicYear:idx("academicYear")>=0?str(row[idx("academicYear")],20):"",term:idx("term")>=0?Number(row[idx("term")]||1):1,room:idx("room")>=0?str(row[idx("room")],80):"",campus:idx("campus")>=0?str(row[idx("campus")],80):"",weekPattern:idx("weekPattern")>=0?str(row[idx("weekPattern")],20):"all",status:idx("status")>=0?str(row[idx("status")],20):"inactive",note:idx("note")>=0?str(row[idx("note")],500):""};if(source.status==="archived")throw new Error("new rows cannot start archived");const resolved=await resolveAcademicScope(req,{classId:classDoc._id,sectionId:section?._id,streamId:stream?._id});if(resolved.errors.length)throw new Error(resolved.errors.join(" "));const scope={classGroup:resolved.payload.classId,sectionId:resolved.payload.sectionId||null,sectionName:resolved.payload.sectionName||"",sectionCode:resolved.payload.sectionCode||"",streamId:resolved.payload.streamId||null,streamName:resolved.payload.streamName||"",streamCode:resolved.payload.streamCode||"",academicYear:resolved.payload.academicYear||subject.academicYear||source.academicYear,term:Number(resolved.payload.term||subject.term||source.term||1),campusName:resolved.payload.campusName||""};const values=buildEntryValues({source,scope,subject,teacher,actorId:actorId(req),now:new Date()});if(values.status==="active"&&values.roomKey){const classroom=await req.models.Classroom.findOne({roomKey:values.roomKey,migrationQuarantinedAt:null}).select("status name code").lean();assertRoomSchedulable(classroom);}values._id=new mongoose.Types.ObjectId();prepared.push(values);}catch(err){errors.push(`Row ${line}: ${err.message}`);}}
      if(errors.length)throw new Error(`Import rejected before writing: ${errors.slice(0,8).join(" ")}${errors.length>8?` (+${errors.length-8} more)`:""}`);if(!prepared.length)throw new Error("No valid rows to import.");
      const inserted=[];
      await withTimetableLocks(req,prepared.filter((d)=>d.status==="active"),async()=>{
        for(let i=0;i<prepared.length;i+=1){
          if(prepared[i].status!=="active")continue;
          const db=await findConflicts(TimetableEntry,prepared[i]);
          if(db.length)throw new Error(`Row ${i+2} conflicts with an existing ${db[0].type} schedule.`);
          for(let j=0;j<i;j+=1)if(conflictKindsBetween(prepared[i],prepared[j]).length)throw new Error(`Rows ${j+2} and ${i+2} conflict with each other.`);
        }
        try{
          for(const values of prepared){const doc=await TimetableEntry.create(values);inserted.push(doc.toObject?doc.toObject():doc);}
        }catch(err){
          await TimetableEntry.deleteMany({_id:{$in:prepared.map((d)=>d._id)}}).catch(()=>null);
          throw err;
        }
      });
      for(const doc of inserted.filter((d)=>d.status==="active"))await syncNotifications(req,null,doc).catch(()=>null);req.flash?.("success",`Imported ${inserted.length} timetable entry/entries.`);
    }catch(err){console.error("IMPORT TIMETABLE CSV ERROR:",err);req.flash?.("error",err.message||"Failed to import CSV.");}
    return res.redirect("/admin/timetable");
  },
};
