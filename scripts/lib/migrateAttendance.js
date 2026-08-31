const mongoose = require("mongoose");
const { normalizeAttendanceStatus, attendanceDateFromSession, str, idText } = require("../../src/services/tenant/attendanceService");

const INDEX_NAME="uniq_active_attendance_student_subject_session";
const INDEX_KEY=Object.freeze({student:1,subject:1,sessionAt:1});
const validId=(v)=>mongoose.Types.ObjectId.isValid(String(v||""));

function legacyStatus(row={}){try{return normalizeAttendanceStatus(row.status||row.attendanceStatus||row.state||"present");}catch{return null;}}
function legacySession(row={}){const v=row.sessionAt||row.date||row.attendanceDate||row.sessionDate||row.createdAt;const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d:null;}

async function dropConflictingIndexes(Attendance){
  if(!Attendance?.collection?.indexes)return 0;let dropped=0;const indexes=await Attendance.collection.indexes();
  for(const idx of indexes){if(idx.name==="_id_")continue;const key=idx.key||{};const same=Number(key.student)===1&&Number(key.subject)===1&&Number(key.sessionAt)===1;const partial=idx.partialFilterExpression||{};const desired=same&&idx.unique===true&&partial.isDeleted===false&&Object.prototype.hasOwnProperty.call(partial,"migrationQuarantinedAt");if(desired)continue;if(idx.unique&&(same||("student" in key&&"subject" in key&&"sessionAt" in key))){await Attendance.collection.dropIndex(idx.name);dropped+=1;}}
  return dropped;
}
async function ensureIndex(Attendance){if(!Attendance?.collection?.createIndex)return false;await Attendance.collection.createIndex(INDEX_KEY,{unique:true,name:INDEX_NAME,partialFilterExpression:{isDeleted:false,migrationQuarantinedAt:null}});return true;}

function preferredScore(row={}){return [row.isDeleted?0:1,Math.max(0,Number(row.revision||0)),new Date(row.correctedAt||row.updatedAt||row.createdAt||0).getTime()||0];}
function comparePreferred(a,b){const aa=preferredScore(a),bb=preferredScore(b);for(let i=0;i<aa.length;i+=1)if(aa[i]!==bb[i])return bb[i]-aa[i];return idText(a._id).localeCompare(idText(b._id));}

async function migrateAttendance(models={},options={}){
  const {Attendance,Student,Subject,Class,Section,Stream}=models; if(!Attendance||!Student||!Subject||!Class||!Section||!Stream)return{skipped:true,reason:"Attendance, Student, Subject, Class, Section and Stream models are required"};
  const timezone=options.timezone||"UTC";const droppedIndexes=await dropConflictingIndexes(Attendance);
  const [rows,students,subjects,classes,sections,streams]=await Promise.all([Attendance.collection.find({}).toArray(),Student.collection.find({}).toArray(),Subject.collection.find({}).toArray(),Class.collection.find({}).toArray(),Section.collection.find({}).toArray(),Stream.collection.find({}).toArray()]);
  const byStudentId=new Map(students.map((x)=>[idText(x._id),x])),byReg=new Map(students.map((x)=>[str(x.regNo,60),x]).filter(([k])=>k));
  const bySubjectId=new Map(subjects.map((x)=>[idText(x._id),x])),bySubjectCode=new Map(subjects.map((x)=>[str(x.code,40).toUpperCase(),x]).filter(([k])=>k));
  const byClassId=new Map(classes.map((x)=>[idText(x._id),x])),bySectionId=new Map(sections.map((x)=>[idText(x._id),x])),byStreamId=new Map(streams.map((x)=>[idText(x._id),x]));
  const normalized=[];let scanned=0,quarantined=0,normalizedCount=0;
  for(const row of rows){scanned+=1;const reasons=[];const student=byStudentId.get(idText(row.student||row.studentId))||byReg.get(str(row.regNo||row.studentRegNo,60))||null;const subject=bySubjectId.get(idText(row.subject||row.course||row.courseId))||bySubjectCode.get(str(row.subjectCode||row.courseCode,40).toUpperCase())||null;const classDoc=byClassId.get(idText(row.classGroup||row.classId||student?.classId||subject?.classId))||null;const section=bySectionId.get(idText(row.sectionId||student?.sectionId||subject?.sectionId))||null;const stream=byStreamId.get(idText(row.streamId||student?.streamId||subject?.streamId))||null;const sessionAt=legacySession(row);const status=legacyStatus(row);
    if(!student||student.isDeleted===true)reasons.push("Student could not be resolved safely.");if(!subject||String(subject.status||"").toLowerCase()==="archived")reasons.push("Subject could not be resolved safely.");if(!classDoc)reasons.push("Class could not be resolved safely.");if(!sessionAt)reasons.push("Session date/time is invalid.");if(!status)reasons.push("Attendance status is invalid.");
    if(subject?.classId&&classDoc&&idText(subject.classId)!==idText(classDoc._id))reasons.push("Subject/class scope conflicts.");if(student?.classId&&classDoc&&idText(student.classId)!==idText(classDoc._id))reasons.push("Student/class scope conflicts.");
    let attendanceDate=null;if(sessionAt){try{attendanceDate=attendanceDateFromSession(sessionAt,timezone);}catch{reasons.push("Tenant attendance date could not be derived.");}}
    const isDeleted=row.isDeleted===true||!!row.deletedAt;const quarantineAt=reasons.length?(row.migrationQuarantinedAt||new Date()):null;if(reasons.length)quarantined+=1;
    const set={student:student?._id||row.student||null,subject:subject?._id||row.subject||null,classGroup:classDoc?._id||null,sectionId:section?._id||null,sectionName:str(row.sectionName||section?.name||student?.section,180),sectionCode:str(row.sectionCode||section?.code,80),streamId:stream?._id||null,streamName:str(row.streamName||stream?.name||student?.stream,180),streamCode:str(row.streamCode||stream?.code,80),teacher:validId(row.teacher||row.teacherId)?(row.teacher||row.teacherId):null,academicYear:str(row.academicYear||subject?.academicYear||student?.academicYear||classDoc?.academicYear,20),term:[1,2,3].includes(Number(row.term||subject?.term||student?.term||classDoc?.term))?Number(row.term||subject?.term||student?.term||classDoc?.term):1,attendanceDate,sessionAt,status:status||"present",notes:str(row.notes||row.remark||row.remarks,500),isDeleted,deletedAt:isDeleted?(row.deletedAt||new Date()):null,revision:Math.max(0,Number(row.revision||0)),firstRecordedAt:row.firstRecordedAt||row.createdAt||sessionAt||new Date(),migrationQuarantinedAt:quarantineAt,migrationQuarantineReason:reasons.join(" ").slice(0,500)};
    await Attendance.collection.updateOne({_id:row._id},{$set:set});normalized.push({...row,...set,_id:row._id});normalizedCount+=1;
  }
  const groups=new Map();for(const row of normalized){if(row.isDeleted||row.migrationQuarantinedAt||!row.student||!row.subject||!row.sessionAt)continue;const key=`${idText(row.student)}:${idText(row.subject)}:${new Date(row.sessionAt).toISOString()}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}let duplicateGroups=0,duplicatesQuarantined=0;
  for(const matches of groups.values()){if(matches.length<2)continue;duplicateGroups+=1;matches.sort(comparePreferred);const keep=matches[0];for(const dup of matches.slice(1)){await Attendance.collection.updateOne({_id:dup._id},{$set:{migrationQuarantinedAt:dup.migrationQuarantinedAt||new Date(),migrationQuarantineReason:`Duplicate attendance row; retained ${keep._id}.`.slice(0,500)}});duplicatesQuarantined+=1;}}
  const indexCreated=await ensureIndex(Attendance);return{scanned,normalized:normalizedCount,quarantined,duplicateGroups,duplicatesQuarantined,droppedIndexes,indexCreated};
}
module.exports={INDEX_NAME,INDEX_KEY,legacyStatus,legacySession,dropConflictingIndexes,ensureIndex,migrateAttendance};
