const mongoose = require("mongoose");
const { body, validationResult } = require("express-validator");
const {
  loadAcademicScopeLists,
  resolveAcademicScope,
  buildAcademicScopeFilter,
} = require("../../../utils/tenantAcademicScope");
const {
  str,
  idText,
  escapeRegExp,
  csvCell,
  normalizeUrlList,
  normalizeDueDateInput,
  formatInTimezone,
  formatDateTimeLocal,
  assertSubjectMatchesScope,
  assignmentTargetStudentFilter,
  assertAssignmentEditable,
  assertAssignmentDeleteAllowed,
  assignmentStatusUpdate,
  gradeSubmissionUpdate,
  reopenSubmissionUpdate,
} = require("../../../services/tenant/assignmentService");

const isObjId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

function requireTenantModels(req, names) {
  if (!req?.models) throw new Error("Tenant models are not attached to this request.");
  const out = {};
  for (const name of names) {
    if (!req.models[name]) throw new Error(`Tenant model ${name} is not loaded.`);
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

function actorId(req) {
  return req.user?._id || req.user?.userId || null;
}

function assignmentQuery(req) {
  const q=str(req.query.q,120);
  const course=str(req.query.course,80);
  const classGroup=str(req.query.classGroup,80);
  const sectionId=str(req.query.sectionId,80);
  const streamId=str(req.query.streamId,80);
  const status=str(req.query.status,20).toLowerCase();
  const filter={isDeleted:{$ne:true},migrationQuarantinedAt:null};
  if(q){ const rx=escapeRegExp(q); filter.$or=[{title:{$regex:rx,$options:"i"}},{instructions:{$regex:rx,$options:"i"}},{rubric:{$regex:rx,$options:"i"}},{courseName:{$regex:rx,$options:"i"}}]; }
  if(course&&isObjId(course))filter.course=course;
  Object.assign(filter,buildAcademicScopeFilter({classGroup,sectionId,streamId}));
  if(["draft","published","closed","archived"].includes(status))filter.status=status;
  return {filter,params:{q,course,classGroup,sectionId,streamId,status}};
}

async function submissionCounts(AssignmentSubmission, assignmentIds) {
  const ids=(assignmentIds||[]).filter(Boolean);
  if(!ids.length)return new Map();
  const rows=await AssignmentSubmission.aggregate([
    {$match:{assignment:{$in:ids},migrationQuarantinedAt:null}},
    {$group:{_id:"$assignment",total:{$sum:1},submitted:{$sum:{$cond:[{$eq:["$status","submitted"]},1,0]}},graded:{$sum:{$cond:[{$eq:["$status","graded"]},1,0]}}}},
  ]);
  return new Map(rows.map((r)=>[String(r._id),r]));
}

async function countAssignmentSubmissions(AssignmentSubmission, assignmentId) {
  return AssignmentSubmission.countDocuments({assignment:assignmentId,migrationQuarantinedAt:null});
}

async function prepareAssignmentValues(req, current=null) {
  const { Subject }=requireTenantModels(req,["Subject"]);
  const courseId=str(req.body.course,80);
  if(!isObjId(courseId))throw new Error("Subject is required.");
  const subject=await Subject.findById(courseId).select("title code name classId className sectionId sectionName streamId streamName academicYear term status").lean();
  if(!subject)throw new Error("Subject not found.");
  const scope=await resolveAcademicScope(req,{classId:req.body.classGroup||subject.classId,sectionId:req.body.sectionId||subject.sectionId,streamId:req.body.streamId||subject.streamId});
  if(scope.errors.length)throw new Error(scope.errors.join(" "));
  assertSubjectMatchesScope(subject,{...scope.payload,classId:scope.payload.classId});
  const totalPoints=Number(req.body.totalPoints ?? current?.totalPoints ?? 100);
  if(!Number.isFinite(totalPoints)||totalPoints<0||totalPoints>1000)throw new Error("Total points must be between 0 and 1000.");
  const dueDate=normalizeDueDateInput(req.body.dueDate,req.tenant?.timezone||"UTC");
  return {
    title:str(req.body.title,200),
    course:subject._id,
    courseName:subject.title||subject.code||subject.name||"",
    classGroup:scope.payload.classId||null,
    className:scope.payload.className||subject.className||"",
    sectionId:scope.payload.sectionId||null,
    sectionName:scope.payload.sectionName||subject.sectionName||"",
    sectionCode:scope.payload.sectionCode||"",
    streamId:scope.payload.streamId||null,
    streamName:scope.payload.streamName||subject.streamName||"",
    streamCode:scope.payload.streamCode||"",
    academicYear:str(subject.academicYear||scope.payload.academicYear,20),
    term:Number(subject.term||scope.payload.term||1),
    dueDate,
    totalPoints,
    allowLateSubmissions:["1","true","on","yes"].includes(String(req.body.allowLateSubmissions||"").toLowerCase()),
    instructions:str(req.body.instructions,4000),
    rubric:str(req.body.rubric,4000),
    attachments:normalizeUrlList(req.body["attachments[]"]??req.body.attachments,30),
    updatedBy:actorId(req),
  };
}

async function syncAssignmentNotifications(req, assignment, action="published") {
  const { Student, Notification }=req.models||{};
  if(!Student||!Notification||!["published","updated"].includes(action))return 0;
  const students=await Student.find(assignmentTargetStudentFilter(assignment)).select("userId").lean();
  const users=[...new Set(students.map((s)=>idText(s.userId)).filter((id)=>isObjId(id)))];
  const due=assignment.dueDate?` Due ${formatInTimezone(assignment.dueDate,req.tenant?.timezone||"UTC")}.`:"";
  const title=action==="published"?"New assignment":"Assignment updated";
  const message=`${assignment.title||"Assignment"} — ${assignment.courseName||"Subject"}.${due}`;
  if(!users.length)return 0;
  const ops=users.map((userId)=>({updateOne:{filter:{userId,entityType:"assignment",entityId:assignment._id,entityAction:action},update:{$set:{audience:"student",title,message,type:"info",url:`/student/assignments/${assignment._id}`,isDeleted:false,deletedAt:null,updatedBy:actorId(req)},$setOnInsert:{createdBy:actorId(req)}},upsert:true}}));
  await Notification.bulkWrite(ops,{ordered:false});
  return users.length;
}

async function retireAssignmentNotifications(req, assignmentId) {
  const { Notification }=req.models||{};
  if(!Notification)return 0;
  const result=await Notification.updateMany({entityType:"assignment",entityId:assignmentId,isDeleted:{$ne:true}},{$set:{isDeleted:true,deletedAt:new Date(),updatedBy:actorId(req)}});
  return result.modifiedCount||0;
}

async function notifyGrade(req, submission, assignment) {
  const { Student, Notification }=req.models||{};
  if(!Student||!Notification)return;
  const student=await Student.findById(submission.student).select("userId").lean();
  if(!student?.userId)return;
  await Notification.findOneAndUpdate(
    {userId:student.userId,entityType:"assignment_submission",entityId:submission._id,entityAction:"graded"},
    {$set:{audience:"student",title:"Assignment graded",message:`${assignment.title}: ${submission.score}/${assignment.totalPoints} (${submission.percentage}%).`,type:"success",url:`/student/assignments/${assignment._id}`,isDeleted:false,deletedAt:null,updatedBy:actorId(req)},$setOnInsert:{createdBy:actorId(req)}},
    {upsert:true,new:true,setDefaultsOnInsert:true}
  );
}

async function changeStatus(req, nextStatus) {
  const { Assignment, AssignmentSubmission }=requireTenantModels(req,["Assignment","AssignmentSubmission"]);
  const id=str(req.params.id,80);
  if(!isObjId(id))throw new Error("Invalid assignment id.");
  const current=await Assignment.findOne({_id:id,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();
  if(!current)throw new Error("Assignment not found.");
  const submissions=await countAssignmentSubmissions(AssignmentSubmission,id);
  const update=assignmentStatusUpdate(current,nextStatus,actorId(req),submissions,new Date());
  const result=await Assignment.updateOne({_id:id,status:current.status,isDeleted:{$ne:true},migrationQuarantinedAt:null},{$set:{...update,updatedAt:new Date()}},{runValidators:true});
  if(result.modifiedCount!==1&&current.status!==nextStatus)throw new Error("Assignment changed in another session. Reload and try again.");
  const after={...current,...update,_id:current._id};
  if(nextStatus==="published")await syncAssignmentNotifications(req,after,current.status==="published"?"updated":"published").catch((e)=>console.error("ASSIGNMENT NOTIFICATION ERROR:",e));
  if(["draft","archived"].includes(nextStatus))await retireAssignmentNotifications(req,id).catch(()=>null);
  return after;
}

async function applyBulkWithCompensation(req, ids, nextStatus) {
  const { Assignment, AssignmentSubmission }=requireTenantModels(req,["Assignment","AssignmentSubmission"]);
  const rows=await Assignment.find({_id:{$in:ids},isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean();
  if(rows.length!==ids.length)throw new Error("One or more selected assignments no longer exist.");
  const prepared=[];
  for(const row of rows){
    const count=await countAssignmentSubmissions(AssignmentSubmission,row._id);
    prepared.push({row,update:assignmentStatusUpdate(row,nextStatus,actorId(req),count,new Date())});
  }
  const changed=[];
  try{
    for(const item of prepared){
      const result=await Assignment.updateOne({_id:item.row._id,status:item.row.status},{$set:{...item.update,updatedAt:new Date()}},{runValidators:true});
      if(result.modifiedCount!==1&&item.row.status!==nextStatus)throw new Error("A selected assignment changed in another session.");
      changed.push(item);
      const after={...item.row,...item.update};
      if(nextStatus==="published")await syncAssignmentNotifications(req,after,item.row.status==="published"?"updated":"published").catch(()=>null);
      if(["draft","archived"].includes(nextStatus))await retireAssignmentNotifications(req,item.row._id).catch(()=>null);
    }
  }catch(err){
    for(const item of changed.reverse()){
      await Assignment.updateOne({_id:item.row._id},{$set:{status:item.row.status,publishedAt:item.row.publishedAt||null,publishedBy:item.row.publishedBy||null,closedAt:item.row.closedAt||null,closedBy:item.row.closedBy||null,archivedAt:item.row.archivedAt||null,archivedBy:item.row.archivedBy||null,revision:Number(item.row.revision||0)}}).catch(()=>null);
    }
    throw err;
  }
  return changed.length;
}

async function insertPreparedWithCompensation(Assignment, docs) {
  const prepared=docs.map((d)=>({_id:d._id||new mongoose.Types.ObjectId(),...d}));
  try { await Assignment.insertMany(prepared,{ordered:true}); return prepared; }
  catch(err){ await Assignment.deleteMany({_id:{$in:prepared.map((d)=>d._id)}}).catch(()=>null); throw err; }
}

const assignmentRules=[
  body("title").trim().isLength({min:2,max:200}).withMessage("Title is required (2-200 chars)."),
  body("course").custom((v)=>isObjId(v)).withMessage("Subject is required."),
  body("classGroup").optional({checkFalsy:true}).custom((v)=>!v||isObjId(v)).withMessage("Invalid class."),
  body("sectionId").optional({checkFalsy:true}).custom((v)=>!v||isObjId(v)).withMessage("Invalid section."),
  body("streamId").optional({checkFalsy:true}).custom((v)=>!v||isObjId(v)).withMessage("Invalid stream."),
  body("totalPoints").optional({checkFalsy:true}).isFloat({min:0,max:1000}).withMessage("Total points must be between 0 and 1000."),
  body("instructions").optional({checkFalsy:true}).trim().isLength({max:4000}),
  body("rubric").optional({checkFalsy:true}).trim().isLength({max:4000}),
];

module.exports={
  assignmentRules,

  list:async(req,res)=>{
    try{
      const { Assignment, AssignmentSubmission, Subject }=requireTenantModels(req,["Assignment","AssignmentSubmission","Subject"]);
      const {filter,params}=assignmentQuery(req);
      const page=Math.max(parseInt(req.query.page||"1",10),1), perPage=18;
      const [total,assignments,scopeLists,kpiRows]=await Promise.all([
        Assignment.countDocuments(filter),
        Assignment.find(filter).populate({path:"course",select:"title code name"}).populate({path:"classGroup",select:"name code classLevel"}).populate({path:"sectionId",select:"name code"}).populate({path:"streamId",select:"name code"}).sort({dueDate:1,createdAt:-1}).skip((page-1)*perPage).limit(perPage).lean(),
        loadAcademicScopeLists(req),
        Assignment.aggregate([{$match:{isDeleted:{$ne:true},migrationQuarantinedAt:null}},{$group:{_id:"$status",c:{$sum:1}}}]),
      ]);
      const counts=await submissionCounts(AssignmentSubmission,assignments.map((a)=>a._id));
      const timezone=req.tenant?.timezone||"UTC";
      const serial=assignments.map((a)=>{const c=counts.get(String(a._id))||{};return {...a,id:String(a._id),courseId:idText(a.course?._id||a.course),classId:idText(a.classGroup?._id||a.classGroup),sectionId:idText(a.sectionId?._id||a.sectionId),streamId:idText(a.streamId?._id||a.streamId),courseName:a.course?.title||a.course?.code||a.courseName||"",className:a.classGroup?.name||a.className||"",sectionName:a.sectionId?.name||a.sectionName||"",streamName:a.streamId?.name||a.streamName||"",dueInput:formatDateTimeLocal(a.dueDate,timezone),dueDisplay:formatInTimezone(a.dueDate,timezone),submissionCount:c.total||0,submittedCount:c.submitted||0,gradedCount:c.graded||0};});
      const m=Object.fromEntries(kpiRows.map((r)=>[r._id,r.c]));
      return res.render("tenant/assignments/index",{tenant:req.tenant||null,assignments:serial,courses:scopeLists.subjects,subjects:scopeLists.subjects,classes:scopeLists.classes,sections:scopeLists.sections,streams:scopeLists.streams,subjectOptions:scopeLists.subjects,kpis:{total:Object.values(m).reduce((a,b)=>a+b,0),published:m.published||0,draft:m.draft||0,closed:m.closed||0,archived:m.archived||0},csrfToken:res.locals.csrfToken||null,query:{...params,page,perPage,total,totalPages:Math.max(Math.ceil(total/perPage),1)},messages:{success:req.flash?req.flash("success"):[],error:req.flash?req.flash("error"):[]}});
    }catch(err){console.error("ASSIGNMENTS LIST ERROR:",err);return res.status(500).send("Failed to load assignments.");}
  },

  create:async(req,res)=>{
    try{
      const { Assignment }=requireTenantModels(req,["Assignment"]);
      const errors=validationResult(req); if(!errors.isEmpty())throw new Error(errors.array().map((e)=>e.msg).join(" "));
      const values=await prepareAssignmentValues(req);
      if(!values.title)throw new Error("Title is required.");
      let doc={...values,status:"draft",createdBy:actorId(req),updatedBy:actorId(req),migrationQuarantinedAt:null};
      if(String(req.body.status||"").toLowerCase()==="published")doc={...doc,...assignmentStatusUpdate(doc,"published",actorId(req),0,new Date())};
      const created=await Assignment.create(doc);
      if(created.status==="published")await syncAssignmentNotifications(req,created.toObject?created.toObject():created,"published").catch((e)=>console.error("ASSIGNMENT NOTIFICATION ERROR:",e));
      req.flash?.("success","Assignment created.");
    }catch(err){console.error("ASSIGNMENT CREATE ERROR:",err);req.flash?.("error",err.message||"Failed to create assignment.");}
    return res.redirect("/admin/assignments");
  },

  update:async(req,res)=>{
    try{
      const { Assignment, AssignmentSubmission }=requireTenantModels(req,["Assignment","AssignmentSubmission"]);
      const errors=validationResult(req); if(!errors.isEmpty())throw new Error(errors.array().map((e)=>e.msg).join(" "));
      const id=str(req.params.id,80); if(!isObjId(id))throw new Error("Invalid assignment id.");
      const current=await Assignment.findOne({_id:id,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean(); if(!current)throw new Error("Assignment not found.");
      const values=await prepareAssignmentValues(req,current);
      const count=await countAssignmentSubmissions(AssignmentSubmission,id);
      assertAssignmentEditable(current,values,count);
      const result=await Assignment.updateOne({_id:id,status:current.status,revision:Number(current.revision||0),isDeleted:{$ne:true}},{$set:{...values,status:current.status,updatedAt:new Date()}},{runValidators:true});
      if(result.modifiedCount!==1)throw new Error("Assignment changed in another session. Reload and try again.");
      if(current.status==="published")await syncAssignmentNotifications(req,{...current,...values},"updated").catch(()=>null);
      req.flash?.("success","Assignment updated.");
    }catch(err){console.error("ASSIGNMENT UPDATE ERROR:",err);req.flash?.("error",err.message||"Failed to update assignment.");}
    return res.redirect("/admin/assignments");
  },

  publish:async(req,res)=>{try{await changeStatus(req,"published");req.flash?.("success","Assignment published.");}catch(err){req.flash?.("error",err.message);}return res.redirect("/admin/assignments");},
  unpublish:async(req,res)=>{try{await changeStatus(req,"draft");req.flash?.("success","Assignment returned to Draft.");}catch(err){req.flash?.("error",err.message);}return res.redirect("/admin/assignments");},
  close:async(req,res)=>{try{await changeStatus(req,"closed");req.flash?.("success","Assignment closed. Existing submissions remain visible and gradable.");}catch(err){req.flash?.("error",err.message);}return res.redirect("/admin/assignments");},
  reopen:async(req,res)=>{try{await changeStatus(req,"published");req.flash?.("success","Assignment reopened for submissions subject to its deadline rules.");}catch(err){req.flash?.("error",err.message);}return res.redirect("/admin/assignments");},
  archive:async(req,res)=>{try{await changeStatus(req,"archived");req.flash?.("success","Assignment archived.");}catch(err){req.flash?.("error",err.message);}return res.redirect("/admin/assignments");},

  remove:async(req,res)=>{
    try{
      const { Assignment, AssignmentSubmission }=requireTenantModels(req,["Assignment","AssignmentSubmission"]);
      const id=str(req.params.id,80); if(!isObjId(id))throw new Error("Invalid assignment id.");
      const current=await Assignment.findOne({_id:id,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean(); if(!current)throw new Error("Assignment not found.");
      const count=await countAssignmentSubmissions(AssignmentSubmission,id); assertAssignmentDeleteAllowed(current,count);
      const result=await Assignment.updateOne({_id:id,status:"draft",isDeleted:{$ne:true}},{$set:{isDeleted:true,deletedAt:new Date(),deletedBy:actorId(req),updatedBy:actorId(req)}});
      if(result.modifiedCount!==1)throw new Error("Assignment changed in another session. Reload and try again.");
      await retireAssignmentNotifications(req,id).catch(()=>null); req.flash?.("success","Draft assignment deleted.");
    }catch(err){console.error("ASSIGNMENT DELETE ERROR:",err);req.flash?.("error",err.message||"Failed to delete assignment.");}
    return res.redirect("/admin/assignments");
  },

  bulk:async(req,res)=>{
    try{
      const action=str(req.body.action,30).toLowerCase();
      const statusMap={publish:"published",unpublish:"draft",close:"closed",reopen:"published",archive:"archived"};
      if(!statusMap[action])throw new Error("Invalid bulk action.");
      const ids=[...new Set(String(req.body.ids||"").split(",").map((x)=>x.trim()).filter(isObjId))]; if(!ids.length)throw new Error("No assignments selected."); if(ids.length>300)throw new Error("Bulk actions are limited to 300 assignments.");
      const changed=await applyBulkWithCompensation(req,ids,statusMap[action]); req.flash?.("success",`Bulk ${action} applied to ${changed} assignment(s).`);
    }catch(err){console.error("ASSIGNMENT BULK ERROR:",err);req.flash?.("error",err.message||"Bulk action failed.");}
    return res.redirect("/admin/assignments");
  },

  importCsv:async(req,res)=>{
    try{
      const { Assignment, Subject }=requireTenantModels(req,["Assignment","Subject"]);
      if(!req.file?.buffer)throw new Error("CSV file is required.");
      const rows=parseCsv(req.file.buffer.toString("utf8")); if(rows.length<2)throw new Error("CSV is empty."); if(rows.length-1>1000)throw new Error("Import is limited to 1,000 assignment rows.");
      const headers=rows[0].map((h)=>str(h,60).toLowerCase()); const idx=(n)=>headers.indexOf(n.toLowerCase());
      const iTitle=idx("title"), iSubject=idx("subjectcode")>=0?idx("subjectcode"):idx("coursecode"), iDue=idx("duedate"), iPoints=idx("totalpoints"), iStatus=idx("status"), iInstr=idx("instructions"), iRubric=idx("rubric"), iAttach=idx("attachments");
      if(iTitle<0||iSubject<0)throw new Error("CSV must include title and subjectCode.");
      const subjects=await Subject.find({status:"active"}).select("_id title code name classId className sectionId sectionName streamId streamName academicYear term status").lean();
      const byCode=new Map(subjects.map((s)=>[String(s.code||"").trim().toUpperCase(),s]));
      const docs=[], errors=[];
      for(let r=1;r<rows.length;r+=1){
        const row=rows[r], line=r+1, title=str(row[iTitle],200), code=str(row[iSubject],40).toUpperCase();
        if(!title||!code){errors.push(`Row ${line}: title and subjectCode are required.`);continue;}
        const subject=byCode.get(code); if(!subject){errors.push(`Row ${line}: unknown active subjectCode ${code}.`);continue;}
        const totalPoints=iPoints>=0&&String(row[iPoints]||"").trim()?Number(row[iPoints]):100; if(!Number.isFinite(totalPoints)||totalPoints<0||totalPoints>1000){errors.push(`Row ${line}: invalid totalPoints.`);continue;}
        let dueDate=null; try{dueDate=iDue>=0&&String(row[iDue]||"").trim()?normalizeDueDateInput(row[iDue],req.tenant?.timezone||"UTC"):null;}catch(e){errors.push(`Row ${line}: ${e.message}`);continue;}
        const rawStatus=iStatus>=0?str(row[iStatus],20).toLowerCase():"draft"; if(!["draft","published"].includes(rawStatus)){errors.push(`Row ${line}: import status must be draft or published.`);continue;}
        if(!subject.classId){errors.push(`Row ${line}: subject has no class scope.`);continue;}
        const now=new Date(); let doc={title,course:subject._id,courseName:subject.title||subject.code||subject.name||"",classGroup:subject.classId,className:subject.className||"",sectionId:isObjId(subject.sectionId)?subject.sectionId:null,sectionName:subject.sectionName||"",streamId:isObjId(subject.streamId)?subject.streamId:null,streamName:subject.streamName||"",academicYear:str(subject.academicYear,20),term:Number(subject.term||1),dueDate,totalPoints,allowLateSubmissions:false,instructions:iInstr>=0?str(row[iInstr],4000):"",rubric:iRubric>=0?str(row[iRubric],4000):"",attachments:iAttach>=0?normalizeUrlList(str(row[iAttach],5000).split("||"),30):[],status:"draft",createdBy:actorId(req),updatedBy:actorId(req),migrationQuarantinedAt:null};
        if(rawStatus==="published")doc={...doc,...assignmentStatusUpdate(doc,"published",actorId(req),0,now)};
        docs.push(doc);
      }
      if(errors.length)throw new Error(`Import rejected before writing: ${errors.slice(0,8).join(" ")}${errors.length>8?` (+${errors.length-8} more)`:""}`);
      if(!docs.length)throw new Error("No valid rows to import.");
      const insertedDocs=await insertPreparedWithCompensation(Assignment,docs);
      for(const doc of insertedDocs.filter((d)=>d.status==="published"))await syncAssignmentNotifications(req,doc,"published").catch(()=>null);
      req.flash?.("success",`Imported ${insertedDocs.length} assignment(s).`);
    }catch(err){console.error("ASSIGNMENT IMPORT ERROR:",err);req.flash?.("error",err.message||"Import failed.");}
    return res.redirect("/admin/assignments");
  },

  exportCsv:async(req,res)=>{
    try{
      const { Assignment }=requireTenantModels(req,["Assignment"]); const {filter}=assignmentQuery(req);
      const rows=await Assignment.find(filter).populate({path:"course",select:"code title"}).populate({path:"classGroup",select:"name code"}).populate({path:"sectionId",select:"name code"}).populate({path:"streamId",select:"name code"}).sort({dueDate:1,createdAt:-1}).lean();
      const header=["title","subjectCode","class","section","stream","academicYear","term","dueDate","totalPoints","allowLateSubmissions","status","instructions","rubric","attachments"];
      const lines=[header.map(csvCell).join(",")];
      for(const a of rows)lines.push([a.title,a.course?.code||"",a.classGroup?.name||a.className||"",a.sectionId?.name||a.sectionName||"",a.streamId?.name||a.streamName||"",a.academicYear||"",a.term||"",a.dueDate?new Date(a.dueDate).toISOString():"",a.totalPoints??100,a.allowLateSubmissions?"yes":"no",a.status||"draft",a.instructions||"",a.rubric||"",Array.isArray(a.attachments)?a.attachments.join("||"):""].map(csvCell).join(","));
      res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",'attachment; filename="assignments.csv"');return res.send(lines.join("\n"));
    }catch(err){console.error("ASSIGNMENT EXPORT ERROR:",err);return res.status(500).send("Export failed.");}
  },

  submissions:async(req,res)=>{
    try{
      const { Assignment, AssignmentSubmission, Student }=requireTenantModels(req,["Assignment","AssignmentSubmission","Student"]);
      const id=str(req.params.id,80); if(!isObjId(id))return res.status(404).send("Assignment not found.");
      const assignment=await Assignment.findOne({_id:id,isDeleted:{$ne:true},migrationQuarantinedAt:null}).populate({path:"course",select:"title code"}).lean(); if(!assignment)return res.status(404).send("Assignment not found.");
      const rows=await AssignmentSubmission.find({assignment:id,migrationQuarantinedAt:null}).populate({path:"student",model:Student,select:"fullName regNo studentNo className section stream"}).sort({status:1,lastSubmittedAt:-1,createdAt:-1}).lean();
      return res.render("tenant/assignments/submissions",{tenant:req.tenant||null,assignment,submissions:rows,csrfToken:res.locals.csrfToken||null,messages:{success:req.flash?req.flash("success"):[],error:req.flash?req.flash("error"):[]}});
    }catch(err){console.error("ASSIGNMENT SUBMISSIONS ERROR:",err);return res.status(500).send("Failed to load submissions.");}
  },

  gradeSubmission:async(req,res)=>{
    const assignmentId=str(req.params.id,80), submissionId=str(req.params.submissionId,80);
    try{
      const { Assignment, AssignmentSubmission }=requireTenantModels(req,["Assignment","AssignmentSubmission"]);
      if(!isObjId(assignmentId)||!isObjId(submissionId))throw new Error("Invalid submission.");
      const [assignment,submission]=await Promise.all([Assignment.findOne({_id:assignmentId,isDeleted:{$ne:true},migrationQuarantinedAt:null}).lean(),AssignmentSubmission.findOne({_id:submissionId,assignment:assignmentId,migrationQuarantinedAt:null}).lean()]);
      if(!assignment||!submission)throw new Error("Submission not found.");
      const update=gradeSubmissionUpdate(submission,assignment,req.body.score,req.body.feedback,actorId(req),new Date());
      const result=await AssignmentSubmission.updateOne({_id:submissionId,status:"submitted",gradeRevision:Number(submission.gradeRevision||0)},{$set:{...update,updatedAt:new Date()}},{runValidators:true});
      if(result.modifiedCount!==1)throw new Error("Submission changed in another session. Reload and try again.");
      await notifyGrade(req,{...submission,...update},assignment).catch((e)=>console.error("GRADE NOTIFICATION ERROR:",e));
      req.flash?.("success","Submission graded.");
    }catch(err){console.error("ASSIGNMENT GRADE ERROR:",err);req.flash?.("error",err.message||"Failed to grade submission.");}
    return res.redirect(`/admin/assignments/${encodeURIComponent(assignmentId)}/submissions`);
  },

  reopenSubmission:async(req,res)=>{
    const assignmentId=str(req.params.id,80), submissionId=str(req.params.submissionId,80);
    try{
      const { AssignmentSubmission }=requireTenantModels(req,["AssignmentSubmission"]); if(!isObjId(assignmentId)||!isObjId(submissionId))throw new Error("Invalid submission.");
      const submission=await AssignmentSubmission.findOne({_id:submissionId,assignment:assignmentId,migrationQuarantinedAt:null}).lean(); if(!submission)throw new Error("Submission not found.");
      const update=reopenSubmissionUpdate(submission,actorId(req),new Date());
      const result=await AssignmentSubmission.updateOne({_id:submissionId,status:"graded",gradeRevision:Number(submission.gradeRevision||0)},{$set:{...update,updatedAt:new Date()}},{runValidators:true});
      if(result.modifiedCount!==1)throw new Error("Submission changed in another session. Reload and try again."); req.flash?.("success","Submission reopened for grading correction.");
    }catch(err){console.error("ASSIGNMENT REOPEN GRADE ERROR:",err);req.flash?.("error",err.message||"Failed to reopen submission.");}
    return res.redirect(`/admin/assignments/${encodeURIComponent(assignmentId)}/submissions`);
  },

  _test:{assignmentQuery,parseCsv,prepareAssignmentValues,applyBulkWithCompensation,insertPreparedWithCompensation},
};
