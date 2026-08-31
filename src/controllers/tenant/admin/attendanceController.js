const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const { loadAcademicScopeLists, resolveAcademicScope, buildAcademicScopeFilter } = require("../../../utils/tenantAcademicScope");
const {
  str, idText, escapeRegExp, csvCell, normalizeAttendanceStatus, attendanceSummary,
  parseTenantDateTime, formatDateTimeLocal, formatInTimezone, attendanceStudentFilter,
  assertSubjectMatchesAttendanceScope, buildAttendanceValues, attendanceCorrectionEntry,
  softDeleteAttendanceUpdate,
} = require("../../../services/tenant/attendanceService");

const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const actorId = (req) => req.user?._id || req.user?.userId || null;

function requireModels(req, names) {
  const out = {};
  for (const name of names) {
    if (!req.models?.[name]) throw new Error(`Tenant model ${name} is not loaded.`);
    out[name] = req.models[name];
  }
  return out;
}

function parseCsv(text) {
  const rows=[]; let row=[]; let cur=""; let quoted=false;
  for(let i=0;i<String(text||"").length;i+=1){
    const ch=text[i], next=text[i+1];
    if(ch==='"'&&quoted&&next==='"'){cur+='"';i+=1;continue;}
    if(ch==='"'){quoted=!quoted;continue;}
    if(!quoted&&ch===','){row.push(cur);cur="";continue;}
    if(!quoted&&ch==='\n'){row.push(cur);rows.push(row);row=[];cur="";continue;}
    if(ch!=='\r')cur+=ch;
  }
  row.push(cur); rows.push(row);
  return rows.filter((r)=>r.some((v)=>String(v||"").trim()));
}

async function loadLists(req, includeStaff=false) {
  const lists=await loadAcademicScopeLists(req,{includeStudents:true});
  let staffList=[];
  if(includeStaff){
    const { Staff }=requireModels(req,["Staff"]);
    staffList=await Staff.find({isDeleted:{$ne:true},status:{$ne:"archived"}}).select("fullName name email role").sort({fullName:1,name:1}).limit(2000).lean();
  }
  return {...lists,staffList};
}

function queryFilter(req) {
  const q=str(req.query.q,120), subject=str(req.query.subject,80), classGroup=str(req.query.classGroup,80), sectionId=str(req.query.sectionId,80), streamId=str(req.query.streamId,80), academicYear=str(req.query.academicYear,20), term=str(req.query.term,10);
  let status=""; try{status=req.query.status?normalizeAttendanceStatus(req.query.status):"";}catch{}
  const timezone=req.tenant?.timezone||"UTC";
  let from=null,to=null; try{if(req.query.from)from=parseTenantDateTime(req.query.from,timezone);}catch{} try{if(req.query.to)to=parseTenantDateTime(req.query.to,timezone);}catch{}
  const filter={isDeleted:{$ne:true},migrationQuarantinedAt:null};
  if(subject&&isObjId(subject))filter.subject=subject;
  Object.assign(filter,buildAcademicScopeFilter({classGroup,sectionId,streamId}));
  if(status)filter.status=status; if(academicYear)filter.academicYear=academicYear; if([1,2,3].includes(Number(term)))filter.term=Number(term);
  if(from||to){filter.sessionAt={};if(from)filter.sessionAt.$gte=from;if(to)filter.sessionAt.$lte=to;}
  return {filter,params:{q,subject,classGroup,sectionId,streamId,status,academicYear,term,from:req.query.from||"",to:req.query.to||""}};
}

async function addSearchFilter(Student, filter, q) {
  if(!q)return true;
  const rx=escapeRegExp(q);
  const students=await Student.find({isDeleted:{$ne:true},$or:[{fullName:{$regex:rx,$options:"i"}},{regNo:{$regex:rx,$options:"i"}},{email:{$regex:rx,$options:"i"}}]}).select("_id").limit(2000).lean();
  filter.student={$in:students.map((s)=>s._id)};
  return students.length>0;
}

async function prepareInput(req, current=null, source=req.body||{}) {
  const { Student, Subject, Staff }=requireModels(req,["Student","Subject","Staff"]);
  let student=null;
  const sid=str(source.student,80), regNo=str(source.regNo,60);
  if(isObjId(sid)) student=await Student.findOne({_id:sid,isDeleted:{$ne:true}}).lean();
  else if(regNo) student=await Student.findOne({regNo,isDeleted:{$ne:true}}).lean();
  if(!student)throw new Error("Student not found.");
  const subjectId=str(source.subject||source.course,80); if(!isObjId(subjectId))throw new Error("Subject is required.");
  const subject=await Subject.findById(subjectId).select("_id code title shortTitle status classId className sectionId sectionName streamId streamName academicYear term").lean();
  if(!subject)throw new Error("Subject not found.");
  const classId=source.classGroup||subject.classId||student.classId;
  const sectionId=source.sectionId||subject.sectionId||null;
  const streamId=source.streamId||subject.streamId||null;
  const resolved=await resolveAcademicScope(req,{classId,sectionId,streamId}); if(resolved.errors.length)throw new Error(resolved.errors.join(" "));
  const scope={classGroup:resolved.payload.classId,sectionId:resolved.payload.sectionId,sectionName:resolved.payload.sectionName,sectionCode:resolved.payload.sectionCode,streamId:resolved.payload.streamId,streamName:resolved.payload.streamName,streamCode:resolved.payload.streamCode,academicYear:subject.academicYear||resolved.payload.academicYear||str(source.academicYear,20),term:Number(subject.term||resolved.payload.term||source.term||1)};
  assertSubjectMatchesAttendanceScope(subject,scope);
  let teacher=null; const teacherId=str(source.teacher,80);
  if(teacherId){if(!isObjId(teacherId))throw new Error("Invalid teacher.");teacher=await Staff.findOne({_id:teacherId,isDeleted:{$ne:true}}).select("_id").lean();if(!teacher)throw new Error("Teacher not found.");}
  const values=buildAttendanceValues({student,subject,scope,sessionAt:source.sessionAt,status:source.status||"present",notes:source.notes||"",teacher:teacher?._id||null,actorId:actorId(req),timezone:req.tenant?.timezone||"UTC",current,correctionReason:source.correctionReason||"",now:new Date()});
  return {student,subject,scope,values};
}

async function attendanceRecipients(req, studentId) {
  const { Student, Parent }=requireModels(req,["Student","Parent"]);
  const student=await Student.findById(studentId).select("userId guardianUserId").lean();
  const recipients=[];
  if(student?.userId)recipients.push({userId:student.userId,audience:"student",url:"/student/attendance"});
  if(student?.guardianUserId)recipients.push({userId:student.guardianUserId,audience:"parent",url:`/parent/attendance?student=${studentId}`});
  const parents=await Parent.find({childrenStudentIds:studentId,isDeleted:{$ne:true},status:{$in:["active","on_hold"]},userId:{$ne:null}}).select("userId").lean();
  for(const p of parents)if(p.userId)recipients.push({userId:p.userId,audience:"parent",url:`/parent/attendance?student=${studentId}`});
  const seen=new Set(); return recipients.filter((r)=>{const k=String(r.userId);if(seen.has(k))return false;seen.add(k);return true;});
}

async function syncAttendanceAlert(req, attendance) {
  const { Notification, Subject }=requireModels(req,["Notification","Subject"]);
  if(!attendance?._id)return;
  const filter={entityType:"attendance",entityId:attendance._id,isDeleted:{$ne:true}};
  if(attendance.isDeleted||!["absent","late"].includes(String(attendance.status))){await Notification.updateMany(filter,{$set:{isDeleted:true,deletedAt:new Date(),updatedBy:actorId(req)}});return;}
  const recipients=await attendanceRecipients(req,attendance.student);
  const subject=await Subject.findById(attendance.subject).select("code title shortTitle").lean();
  const subjectName=subject?.title||subject?.shortTitle||subject?.code||"class";
  const when=formatInTimezone(attendance.sessionAt,req.tenant?.timezone||"UTC");
  for(const r of recipients){
    await Notification.findOneAndUpdate({userId:r.userId,entityType:"attendance",entityId:attendance._id,entityAction:"status"},{$set:{audience:r.audience,title:attendance.status==="absent"?"Attendance absence recorded":"Late attendance recorded",message:`${subjectName} — ${when}. Status: ${attendance.status}.`,type:attendance.status==="absent"?"danger":"warning",url:r.url,isDeleted:false,deletedAt:null,updatedBy:actorId(req)},$setOnInsert:{createdBy:actorId(req)}},{upsert:true,new:true,setDefaultsOnInsert:true});
  }
}

async function mutateExisting(req,current,nextValues,reason="",{skipAlert=false}={}) {
  const { Attendance }=requireModels(req,["Attendance"]);
  const entry=attendanceCorrectionEntry(current,nextValues,actorId(req),reason||nextValues.lastCorrectionReason,new Date());
  const result=await Attendance.updateOne({_id:current._id,revision:Number(current.revision||0),isDeleted:{$ne:true},migrationQuarantinedAt:null},{$set:{...nextValues,updatedAt:new Date()},$push:{corrections:{$each:[entry],$slice:-50}}},{runValidators:true});
  if(result.modifiedCount!==1)throw new Error("Attendance record changed in another session. Reload and try again.");
  const after={...current,...nextValues,_id:current._id};
  if(!skipAlert) await syncAttendanceAlert(req,after).catch((e)=>console.error("ATTENDANCE ALERT ERROR:",e));
  return after;
}

async function runBounded(items, limit, worker) {
  const out=[];
  for(let i=0;i<items.length;i+=limit){
    const batch=items.slice(i,i+limit);
    const settled=await Promise.allSettled(batch.map(worker));
    out.push(...settled);
    if(settled.some((r)=>r.status==="rejected")) break;
  }
  return out;
}

async function syncAttendanceAlertsBatch(req, rows, students, subject) {
  if(!rows.length)return;
  const { Notification, Parent }=requireModels(req,["Notification","Parent"]);
  const studentIds=rows.map((r)=>r.student).filter(Boolean);
  const parents=await Parent.find({childrenStudentIds:{$in:studentIds},isDeleted:{$ne:true},status:{$in:["active","on_hold"]},userId:{$ne:null}}).select("userId childrenStudentIds").lean();
  const studentMap=new Map(students.map((x)=>[String(x._id),x]));
  const parentMap=new Map();
  for(const parent of parents){
    for(const sid of parent.childrenStudentIds||[]){
      const key=String(sid); if(!studentMap.has(key))continue;
      if(!parentMap.has(key))parentMap.set(key,[]);
      parentMap.get(key).push(parent.userId);
    }
  }
  const clearIds=[]; const ops=[];
  const subjectName=subject?.title||subject?.shortTitle||subject?.code||"class";
  for(const row of rows){
    if(!["absent","late"].includes(String(row.status))){clearIds.push(row._id);continue;}
    const student=studentMap.get(String(row.student));
    const recipients=[];
    if(student?.userId)recipients.push({userId:student.userId,audience:"student",url:"/student/attendance"});
    if(student?.guardianUserId)recipients.push({userId:student.guardianUserId,audience:"parent",url:`/parent/attendance?student=${row.student}`});
    for(const userId of parentMap.get(String(row.student))||[])recipients.push({userId,audience:"parent",url:`/parent/attendance?student=${row.student}`});
    const seen=new Set();
    for(const recipient of recipients){
      const key=String(recipient.userId); if(!key||seen.has(key))continue; seen.add(key);
      const when=formatInTimezone(row.sessionAt,req.tenant?.timezone||"UTC");
      ops.push({updateOne:{filter:{userId:recipient.userId,entityType:"attendance",entityId:row._id,entityAction:"status"},update:{$set:{audience:recipient.audience,title:row.status==="absent"?"Attendance absence recorded":"Late attendance recorded",message:`${subjectName} — ${when}. Status: ${row.status}.`,type:row.status==="absent"?"danger":"warning",url:recipient.url,isDeleted:false,deletedAt:null,updatedBy:actorId(req)},$setOnInsert:{createdBy:actorId(req)}},upsert:true}});
    }
  }
  await Promise.all([
    clearIds.length?Notification.updateMany({entityType:"attendance",entityId:{$in:clearIds},isDeleted:{$ne:true}},{$set:{isDeleted:true,deletedAt:new Date(),updatedBy:actorId(req)}}):Promise.resolve(),
    ops.length?Notification.bulkWrite(ops,{ordered:false}):Promise.resolve(),
  ]);
}

async function createPrepared(req,prepared) {
  const { Attendance }=requireModels(req,["Attendance"]);
  const duplicate=await Attendance.findOne({student:prepared.values.student,subject:prepared.values.subject,sessionAt:prepared.values.sessionAt,isDeleted:false,migrationQuarantinedAt:null}).lean();
  if(duplicate)throw new Error("Attendance already exists for this student, subject and session. Edit the existing record instead.");
  const doc=await Attendance.create(prepared.values); const plain=doc.toObject?doc.toObject():doc; await syncAttendanceAlert(req,plain).catch((e)=>console.error("ATTENDANCE ALERT ERROR:",e)); return plain;
}

async function archiveExisting(req,current,reason="") {
  const { Attendance, Notification }=requireModels(req,["Attendance","Notification"]);
  const update=softDeleteAttendanceUpdate(current,actorId(req),reason,new Date());
  const result=await Attendance.updateOne({_id:current._id,revision:Number(current.revision||0),isDeleted:{$ne:true},migrationQuarantinedAt:null},{$set:{...update,updatedAt:new Date()}},{runValidators:true});
  if(result.modifiedCount!==1)throw new Error("Attendance record changed in another session. Reload and try again.");
  await Notification.updateMany({entityType:"attendance",entityId:current._id,isDeleted:{$ne:true}},{$set:{isDeleted:true,deletedAt:new Date(),updatedBy:actorId(req)}}).catch(()=>null);
  return update;
}

async function restoreAttendanceSnapshot(req, snapshot, expectedRevision) {
  const { Attendance }=requireModels(req,["Attendance"]);
  const restore={...snapshot};
  delete restore._id; delete restore.__v;
  const result=await Attendance.updateOne({_id:snapshot._id,revision:Number(expectedRevision)},{$set:restore},{runValidators:false});
  if(result.modifiedCount===1) await syncAttendanceAlert(req,snapshot).catch(()=>null);
  return result.modifiedCount===1;
}

function bulkStatusValues(req,row,status) {
  return {
    student:row.student,
    classGroup:row.classGroup,
    sectionId:row.sectionId||null, sectionName:row.sectionName||"", sectionCode:row.sectionCode||"",
    streamId:row.streamId||null, streamName:row.streamName||"", streamCode:row.streamCode||"",
    subject:row.subject, teacher:row.teacher||null,
    academicYear:row.academicYear||"", term:Number(row.term||1),
    attendanceDate:row.attendanceDate, sessionAt:row.sessionAt,
    status, notes:row.notes||"", isDeleted:false, deletedAt:null, deletedBy:null, deletionReason:"",
    correctedAt:new Date(), correctedBy:actorId(req), lastCorrectionReason:"Bulk attendance correction",
    revision:Number(row.revision||0)+1, updatedBy:actorId(req),
  };
}

const attendanceRules=[
  body("subject").custom((v)=>isObjId(v)).withMessage("Subject is required."),
  body("sessionAt").notEmpty().withMessage("Session date/time is required."),
  body("status").optional({checkFalsy:true}).custom((v)=>{normalizeAttendanceStatus(v);return true;}),
  body("notes").optional({checkFalsy:true}).trim().isLength({max:500}),
  body("correctionReason").optional({checkFalsy:true}).trim().isLength({max:500}),
  body("classGroup").custom((v)=>isObjId(v)).withMessage("Class is required."),
  body("sectionId").optional({checkFalsy:true}).custom((v)=>!v||isObjId(v)),
  body("streamId").optional({checkFalsy:true}).custom((v)=>!v||isObjId(v)),
  body("teacher").optional({checkFalsy:true}).custom((v)=>!v||isObjId(v)),
  body().custom((_,{req})=>{if(isObjId(req.body.student)||str(req.body.regNo,60))return true;throw new Error("Student is required.");}),
];

module.exports={
  attendanceRules,
  list:async(req,res)=>{
    try{
      const { Attendance, Student }=requireModels(req,["Attendance","Student"]); const {filter,params}=queryFilter(req);
      const listsPromise=loadLists(req,true);
      const hasSearch=await addSearchFilter(Student,filter,params.q);
      const page=Math.max(parseInt(req.query.page||"1",10),1),perPage=20; const lists=await listsPromise;
      if(!hasSearch)return res.render("tenant/attendance/index",{tenant:req.tenant||null,records:[],subjects:lists.subjects,classes:lists.classes,sections:lists.sections,streams:lists.streams,students:lists.students,subjectOptions:lists.subjects,studentOptions:lists.students,staffList:lists.staffList,kpis:{total:0,present:0,absent:0,late:0,excused:0,rate:0},csrfToken:res.locals.csrfToken||null,query:{...params,page,perPage,total:0,totalPages:1},messages:{success:req.flash?.("success")||[],error:req.flash?.("error")||[]}});
      const statsRows=await Attendance.aggregate([
        {$match:filter},
        {$group:{_id:null,total:{$sum:1},present:{$sum:{$cond:[{$eq:["$status","present"]},1,0]}},absent:{$sum:{$cond:[{$eq:["$status","absent"]},1,0]}},late:{$sum:{$cond:[{$eq:["$status","late"]},1,0]}},excused:{$sum:{$cond:[{$eq:["$status","excused"]},1,0]}}}},
      ]);
      const statusStats=statsRows[0]||{},total=Number(statusStats.total||0),present=Number(statusStats.present||0),absent=Number(statusStats.absent||0),late=Number(statusStats.late||0),excused=Number(statusStats.excused||0);
      const totalPages=Math.max(Math.ceil(total/perPage),1),safePage=Math.min(page,totalPages);
      const records=await Attendance.find(filter).populate({path:"student",select:"fullName regNo email"}).populate({path:"subject",select:"title code shortTitle"}).populate({path:"classGroup",select:"name code"}).populate({path:"sectionId",select:"name code"}).populate({path:"streamId",select:"name code"}).populate({path:"teacher",select:"fullName name email role"}).sort({sessionAt:-1,createdAt:-1}).skip((safePage-1)*perPage).limit(perPage).lean();
      const attended=present+late+excused;
      const kpis={total,present,absent,late,excused,attended,rate:total?Math.round((attended/total)*10000)/100:0};
      const tz=req.tenant?.timezone||"UTC"; for(const r of records){r.sessionAtInput=formatDateTimeLocal(r.sessionAt,tz);r.sessionAtLabel=formatInTimezone(r.sessionAt,tz);}
      return res.render("tenant/attendance/index",{tenant:req.tenant||null,records,subjects:lists.subjects,classes:lists.classes,sections:lists.sections,streams:lists.streams,students:lists.students,subjectOptions:lists.subjects,studentOptions:lists.students,staffList:lists.staffList,kpis,csrfToken:res.locals.csrfToken||null,query:{...params,page:safePage,perPage,total,totalPages},messages:{success:req.flash?.("success")||[],error:req.flash?.("error")||[]}});
    }catch(err){console.error("ATTENDANCE LIST ERROR:",err);return res.status(500).send("Failed to load attendance.");}
  },
  sheet:async(req,res)=>{
    try{
      const { Attendance, Subject, Student }=requireModels(req,["Attendance","Subject","Student"]); const lists=await loadLists(req,false); const subjectId=str(req.query.subject||req.query.course,80); let selectedCourse=null,selectedClass=null,selectedSection=null,selectedStream=null,roster=[],existingMap={}; let sessionAt=null;
      try{if(req.query.sessionAt)sessionAt=parseTenantDateTime(req.query.sessionAt,req.tenant?.timezone||"UTC");}catch{}
      if(isObjId(subjectId))selectedCourse=await Subject.findOne({_id:subjectId,status:"active"}).lean();
      if(selectedCourse){const resolved=await resolveAcademicScope(req,{classId:req.query.classGroup||selectedCourse.classId,sectionId:req.query.sectionId||selectedCourse.sectionId,streamId:req.query.streamId||selectedCourse.streamId});if(!resolved.errors.length&&resolved.payload.classId){selectedClass=resolved.classDoc;selectedSection=resolved.sectionDoc;selectedStream=resolved.streamDoc;const scope={classGroup:resolved.payload.classId,sectionId:resolved.payload.sectionId,streamId:resolved.payload.streamId,academicYear:selectedCourse.academicYear||resolved.payload.academicYear,term:Number(selectedCourse.term||resolved.payload.term||1)};assertSubjectMatchesAttendanceScope(selectedCourse,scope);roster=await Student.find(attendanceStudentFilter(scope)).select("fullName regNo email classId sectionId streamId academicYear term status").sort({fullName:1}).lean();if(sessionAt){const existing=await Attendance.find({subject:selectedCourse._id,classGroup:scope.classGroup,sectionId:scope.sectionId||null,streamId:scope.streamId||null,sessionAt,isDeleted:{$ne:true},migrationQuarantinedAt:null}).select("student status notes revision").lean();for(const row of existing)existingMap[`s:${row.student}`]={status:row.status,notes:row.notes||"",revision:Number(row.revision||0)};}}}
      return res.render("tenant/attendance/sheet",{tenant:req.tenant||null,courses:lists.subjects,subjects:lists.subjects,classes:lists.classes,sections:lists.sections,streams:lists.streams,selectedCourse,selectedSubject:selectedCourse,selectedClass,selectedSection,selectedStream,roster,existingMap,academicYear:selectedCourse?.academicYear||selectedClass?.academicYear||"",term:Number(selectedCourse?.term||selectedClass?.term||1),sessionAtValue:sessionAt?formatDateTimeLocal(sessionAt,req.tenant?.timezone||"UTC"):str(req.query.sessionAt,40),csrfToken:res.locals.csrfToken||null,messages:{success:req.flash?.("success")||[],error:req.flash?.("error")||[]}});
    }catch(err){console.error("ATTENDANCE SHEET ERROR:",err);return res.status(500).send("Failed to load attendance sheet.");}
  },
  saveSheet:async(req,res)=>{
    try{
      const { Attendance, Subject, Student }=requireModels(req,["Attendance","Subject","Student"]);
      const subjectId=str(req.body.subject||req.body.course,80);
      if(!isObjId(subjectId))throw new Error("Subject is required.");
      const subject=await Subject.findOne({_id:subjectId,status:"active"}).lean();
      if(!subject)throw new Error("Subject not found.");
      const resolved=await resolveAcademicScope(req,{classId:req.body.classGroup||subject.classId,sectionId:req.body.sectionId||subject.sectionId,streamId:req.body.streamId||subject.streamId});
      if(resolved.errors.length||!resolved.payload.classId)throw new Error(resolved.errors.join(" ")||"Attendance class is required.");
      const scope={classGroup:resolved.payload.classId,sectionId:resolved.payload.sectionId,sectionName:resolved.payload.sectionName,sectionCode:resolved.payload.sectionCode,streamId:resolved.payload.streamId,streamName:resolved.payload.streamName,streamCode:resolved.payload.streamCode,academicYear:subject.academicYear||resolved.payload.academicYear,term:Number(subject.term||resolved.payload.term||1)};
      assertSubjectMatchesAttendanceScope(subject,scope);
      const sessionAt=parseTenantDateTime(req.body.sessionAt,req.tenant?.timezone||"UTC");
      const roster=await Student.find(attendanceStudentFilter(scope)).select("_id regNo userId guardianUserId fullName email classId sectionId streamId academicYear term status").lean();
      const byId=new Map(roster.map((student)=>[String(student._id),student]));
      const rows=Array.isArray(req.body.rows)?req.body.rows:[];
      if(!rows.length)throw new Error("No attendance rows submitted.");
      const submittedIds=rows.map((row)=>str(row.student,80));
      if(new Set(submittedIds).size!==submittedIds.length)throw new Error("Attendance sheet contains duplicate student rows.");
      const existingRows=await Attendance.find({student:{$in:submittedIds.filter(isObjId)},subject:subject._id,sessionAt,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();
      const existingByStudent=new Map(existingRows.map((row)=>[String(row.student),row]));
      const prepared=[];
      for(const row of rows){
        const student=byId.get(str(row.student,80));
        if(!student)throw new Error(`Student ${str(row.regNo,60)||"row"} is not in this attendance scope.`);
        const current=existingByStudent.get(String(student._id))||null;
        const values=buildAttendanceValues({student,subject,scope,sessionAt,status:row.status,notes:row.notes,actorId:actorId(req),timezone:req.tenant?.timezone||"UTC",current,correctionReason:"Attendance sheet update"});
        prepared.push({student,current,values});
      }
      const created=[]; const changed=[]; const persisted=[];
      const settled=await runBounded(prepared,8,async(item)=>{
        if(item.current){
          const after=await mutateExisting(req,item.current,item.values,"Attendance sheet update",{skipAlert:true});
          changed.push({item,expectedRevision:Number(item.values.revision||0)}); persisted.push(after); return after;
        }
        const doc=await Attendance.create(item.values); created.push(doc); const plain=doc.toObject?doc.toObject():doc; persisted.push(plain); return plain;
      });
      const failed=settled.find((r)=>r.status==="rejected");
      if(failed){
        for(const d of created)await Attendance.deleteOne({_id:d._id}).catch(()=>null);
        for(const change of changed.reverse())await restoreAttendanceSnapshot(req,change.item.current,change.expectedRevision).catch(()=>null);
        throw failed.reason;
      }
      await syncAttendanceAlertsBatch(req,persisted,roster,subject).catch((e)=>console.error("ATTENDANCE BATCH ALERT ERROR:",e));
      req.flash?.("success",`Saved ${prepared.length} attendance row(s).`);
      return res.redirect(`/admin/attendance/sheet?course=${encodeURIComponent(subjectId)}&sessionAt=${encodeURIComponent(req.body.sessionAt||"")}`);
    }catch(err){console.error("ATTENDANCE SHEET SAVE ERROR:",err);req.flash?.("error",err.message||"Failed to save attendance sheet.");return res.redirect("/admin/attendance/sheet");}
  },
  create:async(req,res)=>{try{const errors=validationResult(req);if(!errors.isEmpty())throw new Error(errors.array().map((e)=>e.msg).join(" "));const p=await prepareInput(req);await createPrepared(req,p);req.flash?.("success","Attendance saved.");return res.redirect(req.body._saveAndNew?"/admin/attendance?new=1":"/admin/attendance");}catch(err){req.flash?.("error",err.message||"Failed to save attendance.");return res.redirect("/admin/attendance");}},
  update:async(req,res)=>{try{const { Attendance }=requireModels(req,["Attendance"]);const errors=validationResult(req);if(!errors.isEmpty())throw new Error(errors.array().map((e)=>e.msg).join(" "));const id=str(req.params.id,80);if(!isObjId(id))throw new Error("Invalid attendance id.");const current=await Attendance.findOne({_id:id,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();if(!current)throw new Error("Attendance record not found.");const p=await prepareInput(req,current);await mutateExisting(req,current,p.values,req.body.correctionReason);req.flash?.("success","Attendance corrected.");return res.redirect("/admin/attendance");}catch(err){req.flash?.("error",err.message||"Failed to update attendance.");return res.redirect("/admin/attendance");}},
  remove:async(req,res)=>{try{const { Attendance }=requireModels(req,["Attendance"]);const id=str(req.params.id,80);if(!isObjId(id))throw new Error("Invalid attendance id.");const current=await Attendance.findOne({_id:id,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();if(!current)throw new Error("Attendance record not found.");await archiveExisting(req,current,req.body.reason||"Administrative archive");req.flash?.("success","Attendance archived.");return res.redirect("/admin/attendance");}catch(err){req.flash?.("error",err.message||"Failed to archive attendance.");return res.redirect("/admin/attendance");}},
  bulk:async(req,res)=>{try{
    const { Attendance }=requireModels(req,["Attendance"]);
    const ids=[...new Set(str(req.body.ids,5000).split(",").map((x)=>x.trim()).filter(isObjId))];
    if(!ids.length)throw new Error("Select at least one attendance record.");
    const rows=await Attendance.find({_id:{$in:ids},isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();
    if(rows.length!==ids.length)throw new Error("One or more selected records are unavailable.");
    const action=str(req.body.action,30), changed=[];
    try{
      if(action==="delete"){
        for(const row of rows){const update=await archiveExisting(req,row,"Bulk attendance archive");changed.push({row,expectedRevision:update.revision});}
        req.flash?.("success",`Archived ${rows.length} record(s).`);
      }else if(action==="set_status"){
        const next=normalizeAttendanceStatus(req.body.status);
        for(const row of rows){const values=bulkStatusValues(req,row,next);await mutateExisting(req,row,values,"Bulk attendance correction");changed.push({row,expectedRevision:values.revision});}
        req.flash?.("success",`Updated ${rows.length} record(s).`);
      }else throw new Error("Unsupported bulk action.");
    }catch(err){
      for(const item of changed.reverse()) await restoreAttendanceSnapshot(req,item.row,item.expectedRevision).catch(()=>null);
      throw err;
    }
    return res.redirect("/admin/attendance");
  }catch(err){req.flash?.("error",err.message||"Bulk action failed.");return res.redirect("/admin/attendance");}},
  importTemplate:async(_req,res)=>{const lines=[["regNo","subjectCode","sessionAt","status","notes"],["REG/2026/001","MATH-P4","2026-08-29 08:00","present","On time"]].map((r)=>r.map(csvCell).join(","));res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="attendance-import-template.csv"');return res.send(lines.join("\n"));},
  importCsv:async(req,res)=>{try{const { Attendance, Student, Subject }=requireModels(req,["Attendance","Student","Subject"]);if(!req.file?.buffer)throw new Error("CSV file is required.");const rows=parseCsv(req.file.buffer.toString("utf8"));if(rows.length<2)throw new Error("CSV contains no data rows.");const headers=rows[0].map((h)=>str(h,60).toLowerCase());const pos=(n)=>headers.indexOf(n);const iReg=pos("regno"),iSubject=pos("subjectcode"),iSession=pos("sessionat"),iStatus=pos("status"),iNotes=pos("notes");if([iReg,iSubject,iSession,iStatus].some((i)=>i<0))throw new Error("Required headers: regNo, subjectCode, sessionAt, status.");const regs=[...new Set(rows.slice(1).map((r)=>str(r[iReg],60)).filter(Boolean))],codes=[...new Set(rows.slice(1).map((r)=>str(r[iSubject],40).toUpperCase()).filter(Boolean))];const [students,subjects]=await Promise.all([Student.find({regNo:{$in:regs},isDeleted:{$ne:true}}).lean(),Subject.find({code:{$in:codes},status:"active"}).lean()]);const byReg=new Map(students.map((s)=>[str(s.regNo,60),s])),byCode=new Map(subjects.map((s)=>[str(s.code,40).toUpperCase(),s]));const prepared=[];for(let n=1;n<rows.length;n+=1){const r=rows[n],student=byReg.get(str(r[iReg],60)),subject=byCode.get(str(r[iSubject],40).toUpperCase());if(!student)throw new Error(`Row ${n+1}: student was not found.`);if(!subject)throw new Error(`Row ${n+1}: active subject was not found.`);const resolved=await resolveAcademicScope(req,{classId:subject.classId||student.classId,sectionId:subject.sectionId||student.sectionId,streamId:subject.streamId||student.streamId});if(resolved.errors.length||!resolved.payload.classId)throw new Error(`Row ${n+1}: ${resolved.errors.join(" ")||"class scope is missing."}`);const scope={classGroup:resolved.payload.classId,sectionId:resolved.payload.sectionId,sectionName:resolved.payload.sectionName,sectionCode:resolved.payload.sectionCode,streamId:resolved.payload.streamId,streamName:resolved.payload.streamName,streamCode:resolved.payload.streamCode,academicYear:subject.academicYear||resolved.payload.academicYear,term:Number(subject.term||resolved.payload.term||1)};const sessionAt=parseTenantDateTime(r[iSession],req.tenant?.timezone||"UTC");const current=await Attendance.findOne({student:student._id,subject:subject._id,sessionAt,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();const values=buildAttendanceValues({student,subject,scope,sessionAt,status:r[iStatus],notes:iNotes>=0?r[iNotes]:"",actorId:actorId(req),timezone:req.tenant?.timezone||"UTC",current,correctionReason:"CSV attendance import"});prepared.push({current,values});}const created=[],changed=[];try{for(const item of prepared){if(item.current){await mutateExisting(req,item.current,item.values,"CSV attendance import");changed.push(item);}else{const d=await Attendance.create(item.values);created.push(d);await syncAttendanceAlert(req,d.toObject?d.toObject():d).catch(()=>null);}}}catch(err){for(const d of created)await Attendance.deleteOne({_id:d._id}).catch(()=>null);for(const item of changed.reverse())await restoreAttendanceSnapshot(req,item.current,Number(item.values.revision||0)).catch(()=>null);throw err;}req.flash?.("success",`Imported/updated ${prepared.length} attendance record(s).`);return res.redirect("/admin/attendance");}catch(err){console.error("ATTENDANCE IMPORT ERROR:",err);req.flash?.("error",err.message||"Import failed.");return res.redirect("/admin/attendance");}},
  exportCsv:async(req,res)=>{try{const { Attendance, Student }=requireModels(req,["Attendance","Student"]);const {filter,params}=queryFilter(req);const has=await addSearchFilter(Student,filter,params.q);let rows=[];if(has)rows=await Attendance.find(filter).populate({path:"student",select:"fullName regNo email"}).populate({path:"classGroup",select:"name code"}).populate({path:"sectionId",select:"name code"}).populate({path:"streamId",select:"name code"}).populate({path:"subject",select:"code title shortTitle"}).sort({sessionAt:-1}).lean();const header=["regNo","studentName","email","className","section","stream","subjectCode","subjectTitle","sessionAt","status","notes","revision","lastCorrectionReason"];const lines=[header.map(csvCell).join(",")];for(const a of rows)lines.push([a.student?.regNo,a.student?.fullName,a.student?.email,a.classGroup?.name,a.sectionId?.name||a.sectionName,a.streamId?.name||a.streamName,a.subject?.code,a.subject?.title||a.subject?.shortTitle,formatInTimezone(a.sessionAt,req.tenant?.timezone||"UTC"),a.status,a.notes,a.revision,a.lastCorrectionReason].map(csvCell).join(","));res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="attendance.csv"');return res.send(lines.join("\n"));}catch(err){console.error("ATTENDANCE EXPORT ERROR:",err);return res.status(500).send("Export failed.");}},
};
